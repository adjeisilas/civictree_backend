import crypto from 'crypto';
import config from '../../config/config.js';

/**
 * Small AES-256-GCM helper for values that must be readable by the app but useless
 * to anyone who only gets a copy of the database (authenticator secrets, voucher PINs).
 *
 * Stored format: v1.<iv>.<authTag>.<ciphertext>, each part base64url.
 *
 * The key comes from SECRET_ENC_KEY (64 hex characters). Without it the key is derived
 * from the JWT refresh secret, so the app still works, but rotating that secret then makes
 * existing encrypted values unreadable — set SECRET_ENC_KEY in production.
 */
const FORMAT_VERSION = 'v1';

const encryptionKey = process.env.SECRET_ENC_KEY
  ? Buffer.from(process.env.SECRET_ENC_KEY, 'hex')
  : crypto.createHmac('sha256', config.jwt.refreshSecret).update('civictree-secret-box').digest();

if (encryptionKey.length !== 32) {
  throw new Error('SECRET_ENC_KEY must be 64 hex characters (32 bytes).');
}

/**
 * @param {string} plainText
 * @returns {string} Encrypted value, safe to store
 */
export const encryptSecret = (plainText) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url')
  ].join('.');
};

/**
 * @param {string} storedValue - Value produced by encryptSecret
 * @returns {string} The original text
 * @throws When the value was not produced by this helper or has been tampered with
 */
export const decryptSecret = (storedValue) => {
  const [version, iv, authTag, ciphertext] = String(storedValue).split('.');

  if (version !== FORMAT_VERSION || !iv || !authTag || !ciphertext) {
    throw new Error('Encrypted value is not in the expected format.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
};

/** True when a stored value looks like it came from encryptSecret. */
export const isEncrypted = (value) => typeof value === 'string' && value.startsWith(`${FORMAT_VERSION}.`);
