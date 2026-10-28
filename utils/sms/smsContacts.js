/**
 * Clearing the SMS contact list.
 *
 * There is no contact table to empty: campaigns are derived from who dialled
 * the USSD shortcode (UssdDialer) and who has ordered (Order.phoneNumber).
 * Those two need different treatment.
 *
 *  - UssdDialer rows are deleted. They are tracking records with nothing else
 *    hanging off them, and because UssdDialer is unique on
 *    (phoneNumber, voucherType) the row *must* go: the tracker only inserts
 *    when no row exists, so a caller who dials again after a clearance would
 *    otherwise never reappear.
 *
 *  - Orders are never deleted. They carry revenue, allocated vouchers,
 *    affiliate commissions and the Hubtel reconciliation trail. Instead each
 *    clearance records a cut-off, and an order-derived contact rejoins
 *    campaigns only when that customer orders again.
 *
 * The effect an admin sees is the one they asked for — the contact count drops
 * to zero and fills up again — without the books being touched.
 */
import { prisma } from '../../config/config.js';
import { VOUCHER_TYPES } from '../voucher/voucherTypes.js';

/**
 * The cut-off for each voucher type: the latest clearance that applies to it,
 * which is either a clearance of that type or a clearance of everything.
 *
 * @returns {Promise<Record<string, Date|null>>}
 */
export async function clearanceCutoffs() {
  const clearances = await prisma.smsContactClearance.findMany({
    orderBy: { clearedAt: 'desc' },
    select: { voucherType: true, clearedAt: true }
  });

  // voucherType null means every type was cleared at once
  const globalCutoff = clearances.find((row) => row.voucherType === null)?.clearedAt ?? null;

  return Object.fromEntries(
    VOUCHER_TYPES.map((type) => {
      const ownCutoff = clearances.find((row) => row.voucherType === type)?.clearedAt ?? null;
      const latest = [globalCutoff, ownCutoff].filter(Boolean);
      return [type, latest.length ? new Date(Math.max(...latest.map((d) => d.getTime()))) : null];
    })
  );
}

/**
 * A Prisma `where` for orders of one type, honouring that type's cut-off.
 * Exported so the recipient builder and the clearance report agree exactly.
 */
export const orderScopeForType = (voucherType, cutoffs) => {
  const cutoff = cutoffs?.[voucherType] ?? null;
  return cutoff ? { voucherType, createdAt: { gt: cutoff } } : { voucherType };
};

/**
 * A Prisma `where` for the orders a campaign may reach.
 *
 * Scoped to one type, or — for a general campaign — the union of every type
 * with its own cut-off applied, so clearing BECE contacts also removes them
 * from the general list.
 */
export const orderScope = (voucherType, cutoffs) =>
  voucherType
    ? orderScopeForType(voucherType, cutoffs)
    : { OR: VOUCHER_TYPES.map((type) => orderScopeForType(type, cutoffs)) };

/** The same, for UssdDialer rows that outlived a clearance. */
export const dialerScope = (voucherType, cutoffs) => {
  if (voucherType) {
    const cutoff = cutoffs?.[voucherType] ?? null;
    return cutoff ? { voucherType, createdAt: { gt: cutoff } } : { voucherType };
  }

  return {
    OR: VOUCHER_TYPES.map((type) => {
      const cutoff = cutoffs?.[type] ?? null;
      return cutoff ? { voucherType: type, createdAt: { gt: cutoff } } : { voucherType: type };
    })
  };
};

/**
 * Clears the contact list, for one voucher type or for all of them.
 *
 * Deleting the dialers and recording the cut-off happen in one transaction, so
 * a failure cannot leave rows deleted without the cut-off that explains it.
 *
 * @param {object} params
 * @param {string|null} [params.voucherType] null clears every type
 * @param {string|null} [params.userId] admin who did it, for the audit trail
 * @returns {Promise<{voucherType: string|null, clearedAt: Date, dialersDeleted: number,
 *                    contactsBefore: number, contactsAfter: number, ordersExcluded: number}>}
 */
export async function clearSmsContacts({ voucherType = null, userId = null }) {
  if (voucherType && !VOUCHER_TYPES.includes(voucherType)) {
    throw new Error(`Unknown voucher type "${voucherType}". Expected one of ${VOUCHER_TYPES.join(', ')}.`);
  }

  // Measured with the same builder the send path uses, so the number reported
  // back is the number of people who will stop receiving campaigns
  const { buildSmsRecipients } = await import('./smsRecipients.js');
  const before = await buildSmsRecipients({ voucherType, recipientType: 'ALL' });

  const cutoffs = await clearanceCutoffs();
  const ordersExcluded = await prisma.order
    .groupBy({ by: ['phoneNumber'], where: orderScope(voucherType, cutoffs) })
    .then((rows) => rows.length);

  const clearedAt = new Date();

  const [deleted] = await prisma.$transaction([
    prisma.ussdDialer.deleteMany({
      where: voucherType ? { voucherType } : {}
    }),
    prisma.smsContactClearance.create({
      data: {
        voucherType,
        clearedAt,
        clearedById: userId,
        dialersDeleted: 0, // corrected immediately below, once the count is known
        ordersExcluded
      }
    })
  ]);

  // The count is only known after the delete runs, so write it back
  await prisma.smsContactClearance.updateMany({
    where: { clearedAt, voucherType },
    data: { dialersDeleted: deleted.count }
  });

  const after = await buildSmsRecipients({ voucherType, recipientType: 'ALL' });

  return {
    voucherType,
    clearedAt,
    dialersDeleted: deleted.count,
    ordersExcluded,
    contactsBefore: before.recipients.length,
    contactsAfter: after.recipients.length
  };
}

/**
 * Per-type contact counts plus when each was last cleared — everything the
 * admin screen needs to label its buttons, in one request.
 */
export async function smsContactSummary() {
  const { buildSmsRecipients } = await import('./smsRecipients.js');

  const clearances = await prisma.smsContactClearance.findMany({
    orderBy: { clearedAt: 'desc' },
    take: 50,
    select: { voucherType: true, clearedAt: true, dialersDeleted: true, ordersExcluded: true }
  });

  const lastClearedFor = (voucherType) =>
    clearances.find((row) => row.voucherType === voucherType)?.clearedAt ?? null;

  const perType = await Promise.all(
    VOUCHER_TYPES.map(async (voucherType) => {
      const { recipients } = await buildSmsRecipients({ voucherType, recipientType: 'ALL' });
      return {
        voucherType,
        contacts: recipients.length,
        lastClearedAt: lastClearedFor(voucherType)
      };
    })
  );

  const all = await buildSmsRecipients({ recipientType: 'ALL' });

  return {
    total: {
      contacts: all.recipients.length,
      lastClearedAt: lastClearedFor(null)
    },
    types: perType,
    recentClearances: clearances.slice(0, 10)
  };
}
