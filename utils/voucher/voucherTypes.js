/**
 * The single description of every voucher type the system sells.
 *
 * Prices, stock thresholds and commissions live in VoucherConfig and
 * AffiliateConfig as one column per type, so adding a type used to mean hunting
 * down every `type === 'BECE' ? x : y` in the codebase — and each of those
 * silently handed the new type whatever the `else` branch held. Everything that
 * varies per type is named here instead, and the helpers below throw on a type
 * they do not know rather than guessing.
 *
 * Adding a fourth type: add an entry here, add the matching columns in
 * prisma/schema.prisma with a migration, and the rest follows.
 */

/** Order matters: it is the order shown in menus, charts and config screens. */
export const VOUCHER_TYPES = ['BECE', 'WASSCE_NOVDEC', 'CTVET_NABTEX'];

const DEFINITIONS = {
  BECE: {
    displayName: 'BECE',
    priceField: 'becePrice',
    limitField: 'beceLimit',
    lastAlertedField: 'beceLastAlertedAt',
    releaseDateField: 'beceReleaseDate',
    commissionField: 'beceCommission',
    defaultCommission: 1.5,
    resultsUrl: 'https://eresults.waecgh.org/'
  },
  WASSCE_NOVDEC: {
    displayName: 'WASSCE/NOVDEC',
    priceField: 'wassceNovdecPrice',
    limitField: 'wassceNovdecLimit',
    lastAlertedField: 'wassceNovdecLastAlertedAt',
    releaseDateField: 'wassceNovdecReleaseDate',
    commissionField: 'wassceNovdecCommission',
    defaultCommission: 2.0,
    resultsUrl: 'https://ghana.waecdirect.org/'
  },
  CTVET_NABTEX: {
    displayName: 'CTVET/NABTEX',
    priceField: 'ctvetNabtexPrice',
    limitField: 'ctvetNabtexLimit',
    lastAlertedField: 'ctvetNabtexLastAlertedAt',
    releaseDateField: 'ctvetNabtexReleaseDate',
    commissionField: 'ctvetNabtexCommission',
    defaultCommission: 1.5,
    // TODO: set the CTVET/NABTEX results-checking portal here. Until it is set,
    // delivery messages for this type carry the serial and PIN with no link,
    // rather than pointing customers at a WAEC page that cannot read their PIN.
    resultsUrl: null
  }
};

/** True when `value` is a voucher type the system sells. */
export const isVoucherType = (value) => VOUCHER_TYPES.includes(value);

const definitionFor = (voucherType) => {
  const definition = DEFINITIONS[voucherType];
  if (!definition) {
    throw new Error(`Unknown voucher type "${voucherType}". Expected one of ${VOUCHER_TYPES.join(', ')}.`);
  }
  return definition;
};

/** How the type is written for customers and admins, e.g. "WASSCE/NOVDEC". */
export const displayNameFor = (voucherType) => definitionFor(voucherType).displayName;

/** Name of the VoucherConfig column holding this type's unit price. */
export const priceFieldFor = (voucherType) => definitionFor(voucherType).priceField;

/** Name of the VoucherConfig column holding this type's low-stock threshold. */
export const limitFieldFor = (voucherType) => definitionFor(voucherType).limitField;

/** Name of the VoucherConfig column recording the last low-stock alert. */
export const lastAlertedFieldFor = (voucherType) => definitionFor(voucherType).lastAlertedField;

/** Name of the VoucherConfig column holding this type's results release date. */
export const releaseDateFieldFor = (voucherType) => definitionFor(voucherType).releaseDateField;

/** Name of the AffiliateConfig column holding this type's commission per voucher. */
export const commissionFieldFor = (voucherType) => definitionFor(voucherType).commissionField;

/** Commission per voucher used when no AffiliateConfig row exists yet. */
export const defaultCommissionFor = (voucherType) => definitionFor(voucherType).defaultCommission;

/**
 * Where a customer checks results for this type, or null when none is
 * configured — callers must omit the link rather than substituting another.
 */
export const resultsUrlFor = (voucherType) => definitionFor(voucherType).resultsUrl;

/** Unit price from a VoucherConfig row, or null when the type is unknown. */
export const unitPriceFrom = (voucherConfig, voucherType) => {
  if (!voucherConfig || !isVoucherType(voucherType)) return null;
  const value = voucherConfig[priceFieldFor(voucherType)];
  return value === null || value === undefined ? null : Number(value);
};

/** Low-stock threshold from a VoucherConfig row, with the schema's fallback. */
export const stockLimitFrom = (voucherConfig, voucherType, fallback = 100) => {
  if (!voucherConfig) return fallback;
  const value = voucherConfig[limitFieldFor(voucherType)];
  return value === null || value === undefined ? fallback : Number(value);
};

/** Commission per voucher from an AffiliateConfig row, falling back per type. */
export const commissionFrom = (affiliateConfig, voucherType) => {
  const fallback = defaultCommissionFor(voucherType);
  if (!affiliateConfig) return fallback;
  const value = affiliateConfig[commissionFieldFor(voucherType)];
  return value === null || value === undefined ? fallback : Number(value);
};

/** `{ BECE: 0, WASSCE_NOVDEC: 0, ... }` — every type present, for API responses. */
export const zeroedByType = (initial = 0) =>
  Object.fromEntries(VOUCHER_TYPES.map((type) => [type, initial]));
