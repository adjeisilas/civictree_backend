import crypto from 'crypto';
import { prisma } from '../../config/config.js';
import { unitPriceFrom } from '../voucher/voucherTypes.js';

/**
 * Largest number of vouchers a single order may contain (web and USSD).
 * Override with MAX_VOUCHERS_PER_ORDER in the environment.
 */
export const MAX_VOUCHERS_PER_ORDER = parseInt(process.env.MAX_VOUCHERS_PER_ORDER, 10) || 20;

/**
 * Generates an order reference like #CT-1042-9F3A61BC.
 * The sequence number is for readability only; uniqueness comes from the
 * cryptographically random suffix (also avoids Hubtel duplicate-reference errors).
 */
export const generateOrderId = async () => {
  const orderCount = await prisma.order.count();
  const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `#CT-${1000 + orderCount + 1}-${randomSuffix}`;
};

/**
 * Current unit price for a voucher type, or null when the type is unknown.
 * Prices are named per type in voucherTypes.js, so a new type cannot quietly
 * inherit another type's price.
 */
export const getUnitPrice = (voucherConfig, voucherType) => unitPriceFrom(voucherConfig, voucherType);

/**
 * Returns the local (0XXXXXXXXX) and international (233XXXXXXXXX) forms of a Ghana number,
 * so orders can be matched whichever format they were saved in.
 */
export const phoneNumberVariants = (phoneNumber) => {
  const trimmed = String(phoneNumber || '').trim().replace(/^\+/, '');
  const variants = new Set([trimmed]);
  if (trimmed.startsWith('233') && trimmed.length === 12) variants.add('0' + trimmed.substring(3));
  if (trimmed.startsWith('0') && trimmed.length === 10) variants.add('233' + trimmed.substring(1));
  return [...variants];
};
