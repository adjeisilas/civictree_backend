import crypto from 'crypto';
import config, { prisma } from '../../config/config.js';

export const OTP_TTL_MS = 10 * 60 * 1000; // codes expire after 10 minutes
export const MAX_OTP_ATTEMPTS = 5; // checks allowed per code (a successful reset uses two)

// Codes are stored as a keyed hash, so a database leak does not reveal usable codes.
const otpKey = crypto
  .createHmac('sha256', process.env.OTP_SECRET || config.jwt.refreshSecret)
  .update('password-reset-otp')
  .digest();

/** Returns a cryptographically random 6-digit code. */
export const generateOtpCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

/** Hash stored in Otp.code for the given user and code. */
export const hashOtpCode = (userId, code) =>
  crypto.createHmac('sha256', otpKey).update(`${userId}:${code}`).digest('hex');

const codeMatches = (userId, code, storedHash) => {
  const expected = Buffer.from(hashOtpCode(userId, code), 'hex');
  const stored = Buffer.from(String(storedHash), 'hex');
  return expected.length === stored.length && crypto.timingSafeEqual(expected, stored);
};

/**
 * Checks a password-reset code for a user.
 * Every check uses up one attempt (counted atomically, so parallel guesses cannot exceed the limit),
 * and the code is withdrawn once the attempts run out.
 *
 * @returns {Promise<Object|null>} The Otp record when the code is correct, otherwise null.
 */
export const checkOtpCode = async (userId, code) => {
  const otp = await prisma.otp.findFirst({
    where: { userId, isUsed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  if (!otp) return null;

  const counted = await prisma.otp.updateMany({
    where: { id: otp.id, isUsed: false, attempts: { lt: MAX_OTP_ATTEMPTS } },
    data: { attempts: { increment: 1 } }
  });
  if (counted.count !== 1) return null;

  if (codeMatches(userId, code, otp.code)) {
    return otp;
  }

  // Withdraw the code once its attempts are used up
  await prisma.otp.updateMany({
    where: { id: otp.id, attempts: { gte: MAX_OTP_ATTEMPTS } },
    data: { isUsed: true }
  });
  return null;
};

/**
 * Creates a new reset code for a user, withdrawing any earlier unused codes.
 * @returns {Promise<string>} The plain code, to be delivered to the user and then discarded.
 */
export const issueOtpCode = async (userId) => {
  const code = generateOtpCode();

  await prisma.$transaction([
    prisma.otp.updateMany({
      where: { userId, isUsed: false },
      data: { isUsed: true }
    }),
    prisma.otp.create({
      data: {
        userId,
        code: hashOtpCode(userId, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS)
      }
    })
  ]);

  return code;
};
