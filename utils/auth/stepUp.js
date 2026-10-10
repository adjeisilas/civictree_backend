import bcrypt from 'bcryptjs';
import { prisma } from '../../config/config.js';
import { AppError } from '../error/AppError.js';
import { assertAccountNotLocked, recordFailedLogin, clearFailedLogins } from './loginGuard.js';
import { verifyTwoFactorChallenge } from './twoFactor.js';

/**
 * Re-checks the signed-in user's own password before a sensitive action
 * (sending money, changing payout details). A stolen session alone is then not enough.
 *
 * Wrong attempts count towards the account lockout, so this cannot be used to guess passwords.
 *
 * @param {string} userId
 * @param {string} password - The password supplied with the request
 */
export const verifyAccountPassword = async (userId, password) => {
  if (!password || typeof password !== 'string') {
    throw new AppError('Your account password is required to confirm this action.', 400);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError('User not found.', 404);
  }

  assertAccountNotLocked(user);

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    await recordFailedLogin(user);
    throw new AppError('Incorrect password. This action was not performed.', 401);
  }

  await clearFailedLogins(user);
  return user;
};

// Kept for readability at admin-only call sites
export const verifyAdminPassword = verifyAccountPassword;


/**
 * Requires a current authenticator code, but only from accounts that have two-factor
 * sign-in switched on. Used where a password prompt would be too much friction but the
 * action still moves money (e.g. approving a withdrawal).
 *
 * @param {string} userId
 * @param {string} [twoFactorCode]
 */
export const requireTwoFactorIfEnabled = async (userId, twoFactorCode) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError('User not found.', 404);
  }

  if (!user.twoFactorEnabled) return user;

  assertAccountNotLocked(user);

  const result = await verifyTwoFactorChallenge(user, twoFactorCode);
  if (!result.ok) {
    await recordFailedLogin(user);
    throw new AppError('Enter the current code from your authenticator app to confirm this action.', 401);
  }

  await clearFailedLogins(user);
  return user;
};

/**
 * Full confirmation before money moves: the account password, plus a current authenticator
 * code when the account has two-factor sign-in switched on.
 *
 * @param {string} userId
 * @param {{ password: string, twoFactorCode?: string }} confirmation
 */
export const verifyStepUp = async (userId, { password, twoFactorCode }) => {
  const user = await verifyAccountPassword(userId, password);

  if (user.twoFactorEnabled) {
    const result = await verifyTwoFactorChallenge(user, twoFactorCode);
    if (!result.ok) {
      throw new AppError('Enter the current code from your authenticator app to confirm this action.', 401);
    }
  }

  return user;
};
