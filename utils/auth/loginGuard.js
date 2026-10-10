import { prisma } from '../../config/config.js';
import { AppError } from '../error/AppError.js';

export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Throws 429 while an account is temporarily locked after repeated wrong passwords.
 */
export const assertAccountNotLocked = (user) => {
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const minutes = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
    throw new AppError(`This account is temporarily locked after too many failed login attempts. Try again in ${minutes} minute(s).`, 429);
  }
};

/**
 * Counts a wrong password. After MAX_FAILED_LOGINS in a row the account is locked for LOCKOUT_MS.
 */
export const recordFailedLogin = async (user) => {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true }
  });

  if (updated.failedLoginAttempts >= MAX_FAILED_LOGINS) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
    });
  }
};

/**
 * Clears the failed-login counter after a successful login or password reset.
 */
export const clearFailedLogins = async (user) => {
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null }
    });
  }
};
