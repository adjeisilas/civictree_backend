import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

// Counters are kept in memory, which is correct for a single server process.
// If the API ever runs on several instances, give these limiters a shared store (e.g. Redis).

const MINUTE = 60 * 1000;

const tooManyRequests = (message) => ({ success: false, status: 429, message });

const emailKey = (req) => String(req.body?.email || '').trim().toLowerCase();

const ipAndEmailKey = (req) => `${ipKeyGenerator(req.ip)}|${emailKey(req)}`;

// Hubtel calls these from a handful of IPs at high volume; they are protected by the IP allow-list instead.
const isHubtelRoute = (req) =>
  req.originalUrl.startsWith('/api/ussd') || req.originalUrl.startsWith('/api/orders/webhook');

/**
 * Baseline limit for every API route.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: isHubtelRoute,
  message: tooManyRequests('Too many requests. Please slow down and try again shortly.')
});

/**
 * Login attempts: per IP + email, plus an overall per-IP ceiling against password spraying.
 */
export const loginLimiter = [
  rateLimit({
    windowMs: 15 * MINUTE,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: ipAndEmailKey,
    skipSuccessfulRequests: true,
    message: tooManyRequests('Too many failed login attempts. Please wait 15 minutes and try again.')
  }),
  rateLimit({
    windowMs: 15 * MINUTE,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: tooManyRequests('Too many failed login attempts from this network. Please try again later.')
  })
];

/**
 * Password reset (request code, check code, set new password).
 */
export const passwordResetLimiter = [
  rateLimit({
    windowMs: 60 * MINUTE,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: ipAndEmailKey,
    message: tooManyRequests('Too many password reset attempts. Please try again in an hour.')
  }),
  rateLimit({
    windowMs: 60 * MINUTE,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: tooManyRequests('Too many password reset attempts from this network. Please try again later.')
  })
];

/**
 * Token refresh and logout.
 */
export const sessionLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests('Too many session requests. Please try again shortly.')
});

/**
 * Affiliate sign-up.
 */
export const registrationLimiter = rateLimit({
  windowMs: 60 * MINUTE,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests('Too many sign-up attempts. Please try again in an hour.')
});

/**
 * Starting a web checkout (each one creates an order and a Hubtel checkout session).
 */
export const orderCreationLimiter = rateLimit({
  windowMs: 10 * MINUTE,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests('Too many purchase attempts. Please wait a few minutes and try again.')
});

/**
 * Customer payment status checks (each one may call Hubtel's status API).
 */
export const paymentVerifyLimiter = rateLimit({
  windowMs: MINUTE,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests('Too many payment checks. Please wait a moment and try again.')
});

/**
 * Two-factor code attempts (login step, enabling, disabling).
 */
export const twoFactorLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: tooManyRequests('Too many verification attempts. Please wait 15 minutes and try again.')
});
