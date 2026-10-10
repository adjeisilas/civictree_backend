/**
 * Warns about configuration that works but will hurt later.
 *
 * Four secrets fall back to being derived from a JWT secret when they are not
 * set. The derived keys are strong, so nothing is insecure — but it couples
 * them: rotating JWT_REFRESH_SECRET then makes every encrypted voucher PIN,
 * password-reset code and two-factor recovery code unreadable, and rotating
 * JWT_ACCESS_SECRET invalidates USSD sessions mid-call. That is a nasty thing
 * to discover during an incident, so say it at startup instead.
 *
 * These are warnings, not errors. Refusing to boot over them would take a
 * working production service down.
 */

/** Secrets that have a fallback, and what rotating that fallback would break. */
const DERIVED_SECRETS = [
  {
    name: 'SECRET_ENC_KEY',
    derivedFrom: 'JWT_REFRESH_SECRET',
    breaks: 'voucher PINs and authenticator secrets become unreadable'
  },
  {
    name: 'OTP_SECRET',
    derivedFrom: 'JWT_REFRESH_SECRET',
    breaks: 'password-reset codes already sent stop verifying'
  },
  {
    name: 'RECOVERY_CODE_SECRET',
    derivedFrom: 'JWT_REFRESH_SECRET',
    breaks: 'two-factor recovery codes stop working'
  },
  {
    name: 'USSD_STATE_SECRET',
    derivedFrom: 'JWT_ACCESS_SECRET',
    breaks: 'USSD sessions in progress are dropped'
  }
];

/**
 * Settings that must never be live in production. These refuse to start rather
 * than warn: with the callback IP check off, anyone on the internet can post a
 * "payment received" callback and be handed free vouchers. A deploy that cannot
 * start is a bad afternoon; this one is a direct route to losing money.
 *
 * It fires at startup, so a misconfigured release never comes up — it does not
 * stop an already running process.
 */
const PRODUCTION_BLOCKERS = [
  {
    check: () => process.env.HUBTEL_IP_CHECK === 'off',
    message:
      'HUBTEL_IP_CHECK=off in production. Payment callbacks would be accepted from any address, ' +
      'so anyone could claim an order was paid. Remove it, or set it to "on".'
  },
  {
    check: () => process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL,
    message: 'DATABASE_URL is not set.'
  }
];

/** Settings that are fine locally and questionable in production. */
const PRODUCTION_EXPECTATIONS = [
  {
    check: () => process.env.ENABLE_API_DOCS === 'true',
    message: 'ENABLE_API_DOCS=true — the Swagger UI is publicly reachable.'
  },
  {
    check: () => !process.env.HUBTEL_CALLBACK_IPS,
    message: 'HUBTEL_CALLBACK_IPS is not set — the callback allow-list has nothing to match against.'
  },
  {
    check: () => !process.env.HUBTEL_CALLBACK_TOKEN,
    message: 'HUBTEL_CALLBACK_TOKEN is not set — callback URLs carry no shared secret.'
  },
  {
    check: () => !process.env.CORS_ORIGINS && !process.env.FRONTEND_URL,
    message: 'Neither FRONTEND_URL nor CORS_ORIGINS is set — no browser origin is allowed to call the API.'
  }
];

/**
 * Checks configuration once at startup. Throws on anything in
 * PRODUCTION_BLOCKERS; everything else is a warning.
 * @param {{ warn: (message: string) => void }} log
 */
export function runStartupChecks(log = console) {
  const isProduction = process.env.NODE_ENV === 'production';
  const warn = (message) => (log.warn ? log.warn(message) : console.warn(message));

  if (isProduction) {
    const blocked = PRODUCTION_BLOCKERS.filter(({ check }) => check()).map(({ message }) => message);
    if (blocked.length > 0) {
      throw new Error(
        'Refusing to start in production:\n' +
        blocked.map((message) => `  - ${message}`).join('\n')
      );
    }
  }

  const unset = DERIVED_SECRETS.filter(({ name }) => !process.env[name]);

  if (unset.length > 0 && isProduction) {
    warn(
      `[CONFIG] ${unset.length} secret(s) are derived from a JWT secret rather than set explicitly. ` +
      'Set them so JWT secrets can be rotated on their own:'
    );
    for (const { name, derivedFrom, breaks } of unset) {
      warn(`[CONFIG]   ${name} (from ${derivedFrom}) — rotating ${derivedFrom} means ${breaks}`);
    }
  }

  if (isProduction) {
    for (const { check, message } of PRODUCTION_EXPECTATIONS) {
      if (check()) warn(`[CONFIG] ${message}`);
    }
  }

  return { derivedSecrets: unset.map(({ name }) => name) };
}
