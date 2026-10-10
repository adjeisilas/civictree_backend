import crypto from 'crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import config, { prisma } from '../../config/config.js';
import { encryptSecret, decryptSecret } from '../crypto/secretBox.js';

export const RECOVERY_CODE_COUNT = 10;
const TOTP_STEP_SECONDS = 30;

// Accept the code before and after the current one, so a slightly wrong clock still works
authenticator.options = { window: 1, step: TOTP_STEP_SECONDS };

// Recovery codes are stored as a keyed hash, like password reset codes
const recoveryKey = crypto
  .createHmac('sha256', process.env.RECOVERY_CODE_SECRET || config.jwt.refreshSecret)
  .update('two-factor-recovery-code')
  .digest();

const hashRecoveryCode = (userId, code) =>
  crypto.createHmac('sha256', recoveryKey).update(`${userId}:${code.toUpperCase()}`).digest('hex');

/** A new, unsaved authenticator secret. */
export const generateTwoFactorSecret = () => authenticator.generateSecret();

/**
 * The otpauth:// URI an authenticator app scans, plus a QR image to show.
 * @returns {Promise<{ otpauthUrl: string, qrCodeDataUrl: string }>}
 */
export const buildEnrolmentDetails = async (email, secret) => {
  const otpauthUrl = authenticator.keyuri(email, 'CivicTree Admin', secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240, margin: 1 });
  return { otpauthUrl, qrCodeDataUrl };
};

/** Checks a 6-digit code against a secret (no database involved). */
export const isValidTotp = (secret, code) => {
  try {
    return authenticator.check(String(code).trim(), secret);
  } catch {
    return false;
  }
};

/**
 * Finds which 30-second step a code belongs to (the current one, or one either side for
 * clock drift). Returns null when the code does not match the secret at all.
 *
 * The step is recorded after use, so each code works only once.
 */
const findMatchingStep = (secret, code) => {
  const supplied = String(code).trim();
  if (!/^\d{6}$/.test(supplied)) return null;

  for (const offset of [0, -1, 1]) {
    const epoch = Date.now() + offset * TOTP_STEP_SECONDS * 1000;
    const expected = authenticator.clone({ epoch }).generate(secret);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
      return Math.floor(epoch / 1000 / TOTP_STEP_SECONDS);
    }
  }
  return null;
};

/**
 * Checks a code from an authenticator app for a user, and records the time step
 * so the same code cannot be used again.
 *
 * @returns {Promise<boolean>}
 */
export const verifyTwoFactorCode = async (user, code) => {
  if (!user.twoFactorSecret) return false;

  let secret;
  try {
    secret = decryptSecret(user.twoFactorSecret);
  } catch {
    console.error(`[2FA] Could not read the stored secret for user ${user.id}`);
    return false;
  }

  const step = findMatchingStep(secret, code);
  if (step === null) return false;

  // Accept each step only once, so a code cannot be replayed
  const claimed = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }]
    },
    data: { twoFactorLastStep: step }
  });

  return claimed.count === 1;
};

/**
 * Checks a recovery code and uses it up. Each code works once.
 * @returns {Promise<boolean>}
 */
export const verifyRecoveryCode = async (user, code) => {
  const normalized = String(code || '').trim().toUpperCase().replace(/\s/g, '');
  if (!/^[0-9A-Z-]{8,20}$/.test(normalized)) return false;

  const codeHash = hashRecoveryCode(user.id, normalized);
  const used = await prisma.twoFactorRecoveryCode.updateMany({
    where: { userId: user.id, codeHash, usedAt: null },
    data: { usedAt: new Date() }
  });

  return used.count === 1;
};

/**
 * Replaces a user's recovery codes with a fresh set.
 * @returns {Promise<string[]>} The plain codes — shown to the user once, then unrecoverable.
 */
export const issueRecoveryCodes = async (userId) => {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 characters
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.twoFactorRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(userId, code) }))
    })
  ]);

  return codes;
};

/** Stores a secret for a user (encrypted), without switching two-factor on yet. */
export const storePendingSecret = (userId, secret) =>
  prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false, twoFactorLastStep: null }
  });

/** Switches two-factor off and removes the secret and recovery codes. */
export const disableTwoFactor = (userId) =>
  prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: null, twoFactorEnabled: false, twoFactorLastStep: null }
    })
  ]);

/**
 * Accepts either an authenticator code or a recovery code.
 * @returns {Promise<{ ok: boolean, usedRecoveryCode?: boolean }>}
 */
export const verifyTwoFactorChallenge = async (user, code) => {
  if (await verifyTwoFactorCode(user, code)) return { ok: true, usedRecoveryCode: false };
  if (await verifyRecoveryCode(user, code)) return { ok: true, usedRecoveryCode: true };
  return { ok: false };
};
