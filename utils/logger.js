import crypto from 'crypto';
import winston from 'winston';

/**
 * Application logger.
 *
 * Logs are JSON in production (searchable in a log service) and readable text in development.
 * Anything that looks like a secret is replaced with [redacted] before it is written, so a PIN,
 * password, token or authenticator secret cannot end up in the logs by accident.
 */
const SENSITIVE_KEY_PATTERN = /^(pin|password|passwordhash|currentpassword|newpassword|confirmpassword|token|accesstoken|refreshtoken|challengetoken|authorization|apikey|apisecret|secret|twofactorsecret|twofactorcode|code|otp|clientsecret|recoverycode|recoverycodes)$/i;

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

/** Recursively replaces sensitive values. Returns a copy; the input is never changed. */
export const redact = (value, depth = 0) => {
  if (depth > MAX_DEPTH || value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return output;
  }

  return value;
};

// Winston keeps internal symbol properties on `info`, so change it in place rather than
// returning a new object — a replacement loses them and the line is never written.
const redactFormat = winston.format((info) => {
  const { level, message, timestamp, ...meta } = info;
  const redactedMeta = redact(meta);

  for (const key of Object.keys(meta)) delete info[key];
  Object.assign(info, redactedMeta);

  return info;
});

const isProduction = process.env.NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp(),
    redactFormat(),
    isProduction
      ? winston.format.json()
      : winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level}: ${message}${extra}`;
        })
  ),
  transports: [new winston.transports.Console()],
  // Never let logging crash a request
  exitOnError: false
});

/**
 * Express middleware: gives each request an id and logs how it finished.
 * The id also appears in error responses, so a user's report can be matched to a log line.
 */
export const requestLogger = (req, res, next) => {
  const startedAt = Date.now();
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  res.on('finish', () => {
    logger.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip
    });
  });

  next();
};

export default logger;
