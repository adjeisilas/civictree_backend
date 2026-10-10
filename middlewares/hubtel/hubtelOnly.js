import crypto from 'crypto';
import config from '../../config/config.js';

// Source IPs Hubtel publishes for its callbacks:
//   Online Checkout callback: 108.129.40.25
//   Receive Money callback:   18.202.122.131
//   USSD service fulfillment: 52.50.116.54, 18.202.122.131, 52.31.15.68
// Override with HUBTEL_CALLBACK_IPS (comma-separated) if Hubtel gives you a different list.
const DEFAULT_HUBTEL_IPS = ['108.129.40.25', '18.202.122.131', '52.50.116.54', '52.31.15.68'];

let allowedIps = null;

const getAllowedIps = () => {
  if (!allowedIps) {
    const configured = (process.env.HUBTEL_CALLBACK_IPS || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
    allowedIps = new Set(configured.length > 0 ? configured : DEFAULT_HUBTEL_IPS);
  }
  return allowedIps;
};

const normalizeIp = (ip) => (ip && ip.startsWith('::ffff:') ? ip.substring(7) : ip);

/**
 * Only lets requests from Hubtel's IP addresses through.
 *
 * HUBTEL_IP_CHECK controls the behaviour:
 *   enforce (default) - reject other IPs with 403
 *   monitor           - allow, but log requests that would have been rejected
 *                       (use briefly to confirm Hubtel's real IPs before enforcing)
 *   off               - no check (local development only)
 *
 * Relies on Express `trust proxy` being set correctly so req.ip is the real client IP.
 */
export const hubtelOnly = (req, res, next) => {
  const mode = (process.env.HUBTEL_IP_CHECK || 'enforce').toLowerCase();
  if (mode === 'off') return next();

  const ip = normalizeIp(req.ip);
  if (getAllowedIps().has(ip)) return next();

  console.warn(`[HUBTEL IP CHECK] ${mode === 'monitor' ? 'Would block' : 'Blocked'} ${req.method} ${req.originalUrl} from ${ip}`);

  if (mode === 'monitor') return next();

  return res.status(403).json({ success: false, message: 'Forbidden' });
};

/**
 * When HUBTEL_CALLBACK_TOKEN is set, the payment callback URL we give Hubtel contains that token
 * (/api/orders/webhook/<token>) and requests without the matching token are rejected.
 */
export const requireHubtelCallbackToken = (req, res, next) => {
  const expected = config.hubtel.callbackToken;
  if (!expected) return next();

  const provided = Buffer.from(String(req.params.token || ''));
  const expectedBuffer = Buffer.from(expected);

  if (provided.length !== expectedBuffer.length || !crypto.timingSafeEqual(provided, expectedBuffer)) {
    console.warn(`[HUBTEL CALLBACK TOKEN] Rejected ${req.method} ${req.baseUrl} from ${normalizeIp(req.ip)}`);
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  return next();
};
