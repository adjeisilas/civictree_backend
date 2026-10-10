import { prisma } from '../../config/config.js';

// Money already promised to a withdrawal: requested but not yet settled, or currently being paid out.
export const IN_FLIGHT_WITHDRAWAL_STATUSES = ['PENDING', 'PROCESSING'];
// Money that has left the business.
export const SETTLED_WITHDRAWAL_STATUSES = ['APPROVED'];

// Withdrawals are blocked for this long after payout details change, so a stolen account
// cannot immediately redirect earnings to a new number.
export const PAYOUT_DETAILS_HOLD_MS = 48 * 60 * 60 * 1000;

/**
 * Works out an affiliate's balances from their commissions and withdrawals.
 * Used by the portal, the admin screens and the withdrawal check, so they always agree.
 *
 * @param {string} affiliateId
 * @param {object} [client] - Prisma client or transaction client
 */
export const getAffiliateBalance = async (affiliateId, client = prisma) => {
  const [commissionTotal, settledTotal, inFlightTotal] = await Promise.all([
    client.affiliateCommission.aggregate({ where: { affiliateId }, _sum: { amount: true } }),
    client.withdrawalRequest.aggregate({
      where: { affiliateId, status: { in: SETTLED_WITHDRAWAL_STATUSES } },
      _sum: { amount: true }
    }),
    client.withdrawalRequest.aggregate({
      where: { affiliateId, status: { in: IN_FLIGHT_WITHDRAWAL_STATUSES } },
      _sum: { amount: true }
    })
  ]);

  const totalEarned = Number(commissionTotal._sum.amount || 0);
  const withdrawn = Number(settledTotal._sum.amount || 0);
  const pending = Number(inFlightTotal._sum.amount || 0);

  return {
    totalEarned,
    withdrawn,
    pending,
    available: Math.max(0, totalEarned - withdrawn - pending)
  };
};

/**
 * Milliseconds left on the post-change withdrawal hold, or 0 when withdrawals are allowed.
 */
export const payoutHoldRemainingMs = (profile) => {
  if (!profile.payoutDetailsUpdatedAt) return 0;
  const elapsed = Date.now() - new Date(profile.payoutDetailsUpdatedAt).getTime();
  return Math.max(0, PAYOUT_DETAILS_HOLD_MS - elapsed);
};
