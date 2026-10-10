import { encryptSecret, decryptSecret, isEncrypted } from '../crypto/secretBox.js';

/**
 * Voucher PINs are the product being sold, so they are encrypted at rest: a copy of the
 * database is then worth nothing without the key (SECRET_ENC_KEY).
 *
 * Rows created before encryption was introduced are still plain text; readPin handles both,
 * and scripts/encrypt_voucher_pins.js converts the old rows.
 */

/** Value to store in Voucher.pin. */
export const encryptPin = (pin) => encryptSecret(String(pin).trim());

/** The usable PIN from a stored value (plain text rows still work). */
export const readPin = (storedPin) => {
  if (!storedPin) return '';
  return isEncrypted(storedPin) ? decryptSecret(storedPin) : storedPin;
};

/**
 * What admin lists show: everything hidden except the last few characters,
 * enough to match against a customer's complaint without exposing the PIN.
 */
export const maskPin = (storedPin, visibleChars = 3) => {
  const pin = readPin(storedPin);
  if (!pin) return '';
  if (pin.length <= visibleChars) return '•'.repeat(pin.length);
  return '•'.repeat(pin.length - visibleChars) + pin.slice(-visibleChars);
};

/** Replaces the pin on a voucher record (or list of them) with its masked form. */
export const withMaskedPin = (voucher) => {
  if (Array.isArray(voucher)) return voucher.map(withMaskedPin);
  if (!voucher || typeof voucher !== 'object' || !('pin' in voucher)) return voucher;
  return { ...voucher, pin: maskPin(voucher.pin), pinMasked: true };
};
