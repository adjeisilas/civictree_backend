/**
 * Builds the recipient list for a bulk SMS campaign.
 *
 * There is no contact list in this system: recipients are derived at send time
 * from who has ordered (Order.phoneNumber) and who has dialled the USSD
 * shortcode (UssdDialer.phoneNumber).
 *
 * Those two sources store numbers differently. USSD receives Hubtel's `Mobile`
 * as 233XXXXXXXXX, while web checkout collects 0XXXXXXXXX. Deduplicating the raw
 * strings therefore treated one person as two, and they were charged for — and
 * sent — the same message twice. Every number is canonicalised to 233XXXXXXXXX
 * first, which is also the form Hubtel sends to.
 *
 * The same function answers "how many people would this reach?", so the count
 * the admin approves is the list that actually goes out.
 */
import { prisma } from '../../config/config.js';

export const RECIPIENT_TYPES = ['ALL', 'SUCCESSFUL', 'FAILED_ONLY'];

/** Ghana mobile numbers in the form Hubtel accepts. */
const CANONICAL_PATTERN = /^233[235679]\d{8}$/;

/**
 * One number in canonical 233XXXXXXXXX form, or null if it is not usable.
 *
 * Accepts the shapes actually present in the database: international with or
 * without a +, local with a leading 0, and the occasional row saved without it.
 */
export const toCanonicalPhone = (value) => {
  if (!value) return null;

  // Strip the separators people type and the + Hubtel sometimes includes
  const digits = String(value).trim().replace(/^\+/, '').replace(/[\s()-]/g, '');
  if (!/^\d+$/.test(digits)) return null;

  let canonical = digits;
  if (digits.length === 10 && digits.startsWith('0')) {
    canonical = `233${digits.slice(1)}`;
  } else if (digits.length === 9) {
    // Saved without the leading zero
    canonical = `233${digits}`;
  }

  return CANONICAL_PATTERN.test(canonical) ? canonical : null;
};

/** Canonicalises a list, reporting what was merged and what was unusable. */
const canonicaliseAll = (values) => {
  const unique = new Set();
  let unusable = 0;

  for (const value of values) {
    const canonical = toCanonicalPhone(value);
    if (canonical) unique.add(canonical);
    else if (value && String(value).trim()) unusable += 1;
  }

  return { unique, unusable };
};

/**
 * Resolves a campaign segment to the phone numbers it would reach.
 *
 * @param {object} params
 * @param {'BECE'|'WASSCE_NOVDEC'|null} [params.voucherType] Limit to one product
 * @param {'ALL'|'SUCCESSFUL'|'FAILED_ONLY'} params.recipientType
 * @returns {Promise<{recipients: string[], sourceRows: number, duplicatesMerged: number, unusable: number}>}
 */
export async function buildSmsRecipients({ voucherType = null, recipientType }) {
  const segment = String(recipientType || '').toUpperCase();
  if (!RECIPIENT_TYPES.includes(segment)) {
    throw new Error(`Invalid recipientType "${recipientType}". Must be one of ${RECIPIENT_TYPES.join(', ')}.`);
  }

  // Only filter by voucher type when one was asked for
  const scope = voucherType ? { voucherType } : {};
  let rawNumbers = [];

  if (segment === 'ALL') {
    // Everyone who dialled plus everyone who ordered, whether they paid or not
    const [dialers, orders] = await Promise.all([
      prisma.ussdDialer.findMany({ where: scope, select: { phoneNumber: true } }),
      prisma.order.groupBy({ by: ['phoneNumber'], where: scope })
    ]);
    rawNumbers = [...dialers, ...orders].map((row) => row.phoneNumber);
  } else if (segment === 'SUCCESSFUL') {
    const paid = await prisma.order.groupBy({
      by: ['phoneNumber'],
      where: { ...scope, paymentStatus: 'SUCCESS' }
    });
    rawNumbers = paid.map((row) => row.phoneNumber);
  } else {
    // Anyone who tried and never succeeded. Compared after canonicalising, so
    // someone who paid as 024… is not treated as unpaid because they also
    // appear as 23324… on an abandoned attempt.
    const [paid, everyone] = await Promise.all([
      prisma.order.groupBy({ by: ['phoneNumber'], where: { ...scope, paymentStatus: 'SUCCESS' } }),
      prisma.order.groupBy({ by: ['phoneNumber'], where: scope })
    ]);

    const paidPhones = canonicaliseAll(paid.map((row) => row.phoneNumber)).unique;
    const { unique: allPhones, unusable } = canonicaliseAll(everyone.map((row) => row.phoneNumber));

    const recipients = [...allPhones].filter((phone) => !paidPhones.has(phone));
    return {
      recipients,
      sourceRows: everyone.length,
      duplicatesMerged: Math.max(0, everyone.length - unusable - allPhones.size),
      unusable
    };
  }

  const { unique, unusable } = canonicaliseAll(rawNumbers);

  return {
    recipients: [...unique],
    sourceRows: rawNumbers.length,
    // Rows that collapsed into a number already in the list
    duplicatesMerged: Math.max(0, rawNumbers.length - unusable - unique.size),
    unusable
  };
}
