/**
 * The USSD menu layout, shared by the main shortcode and the affiliate codes.
 *
 * Both controllers used to spell out "1. Buy BECE ... 3. Transactions" in their
 * own string, so the two menus could drift apart and adding a voucher type meant
 * renumbering by hand in two files. The numbers are derived from VOUCHER_TYPES
 * here instead: buying occupies 1..N, and the fixed options follow.
 *
 * Note on length: Hubtel truncates a USSD screen at roughly 160 characters. With
 * three voucher types the main menu is about 152, so there is little headroom —
 * a fourth type, or a long affiliate business name in the header, will need the
 * lines shortened.
 */
import { VOUCHER_TYPES, displayNameFor, priceFieldFor, releaseDateFieldFor } from '../voucher/voucherTypes.js';

/**
 * Menu numbering and text for the current set of voucher types.
 *
 * @param {object} config VoucherConfig row, for prices
 * @returns {{ buyOptions: {key: string, voucherType: string}[], transactions: string,
 *             releaseDates: string, support: string, text: (header?: string) => string }}
 */
export const mainMenu = (config) => {
  const buyOptions = VOUCHER_TYPES.map((voucherType, index) => ({
    key: String(index + 1),
    voucherType
  }));

  const afterBuying = VOUCHER_TYPES.length;
  const transactions = String(afterBuying + 1);
  const releaseDates = String(afterBuying + 2);
  const support = String(afterBuying + 3);

  const text = (header = 'CivicTree Vouchers:') => [
    header,
    ...buyOptions.map(({ key, voucherType }) => {
      const price = Number(config?.[priceFieldFor(voucherType)] ?? 0).toFixed(2);
      return `${key}. Buy ${displayNameFor(voucherType)} (GHS ${price})`;
    }),
    `${transactions}. Transactions`,
    `${releaseDates}. Release Dates`,
    `${support}. Support`
  ].join('\n');

  return { buyOptions, transactions, releaseDates, support, text };
};

/** Maps a main-menu keypress to a voucher type, or null when it is not a buy option. */
export const voucherTypeForKey = (key) => {
  const index = Number(key) - 1;
  return Number.isInteger(index) && index >= 0 && index < VOUCHER_TYPES.length
    ? VOUCHER_TYPES[index]
    : null;
};

/** The release-date submenu, numbered in the same order as the buy options. */
export const releaseDateMenu = () => ({
  text: [
    'Select Release Date:',
    ...VOUCHER_TYPES.map((voucherType, index) => `${index + 1}. ${displayNameFor(voucherType)} Results`)
  ].join('\n'),
  voucherTypeForKey
});

/**
 * The sentence read back for a type's results date.
 * @param {object} config VoucherConfig row
 * @param {string} voucherType
 * @param {(date: Date) => string} formatDate
 */
export const releaseDateMessage = (config, voucherType, formatDate) => {
  const stored = config?.[releaseDateFieldFor(voucherType)];
  const when = stored ? formatDate(stored).split(' ')[0] : 'To be announced';
  return `The ${displayNameFor(voucherType)} results are expected to be released on ${when}.`;
};
