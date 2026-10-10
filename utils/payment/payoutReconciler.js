import { prisma } from '../../config/config.js';
import { checkHubtelPayoutStatus } from './hubtelHelper.js';
import { logActivity } from '../activityLog/activityLogger.js';
import { notifyAllAdmins } from '../notification/pushHelper.js';

/**
 * Payouts are sent with the record's id (dashes removed) as the Hubtel client reference,
 * so a reference can be matched back to the record it belongs to.
 */
export const referenceFor = (recordId) => recordId.replace(/-/g, '');

const findByReference = async (clientReference) => {
  const reference = String(clientReference || '').trim();
  if (!/^[0-9a-zA-Z]{1,64}$/.test(reference)) return null;

  const [withdrawal] = await prisma.$queryRaw`
    SELECT id FROM WithdrawalRequest WHERE REPLACE(id, '-', '') = ${reference} LIMIT 1`;
  if (withdrawal) {
    return { type: 'AFFILIATE', record: await prisma.withdrawalRequest.findUnique({ where: { id: withdrawal.id }, include: { affiliate: true } }) };
  }

  const [adminWithdrawal] = await prisma.$queryRaw`
    SELECT id FROM AdminWithdrawal WHERE REPLACE(id, '-', '') = ${reference} LIMIT 1`;
  if (adminWithdrawal) {
    return { type: 'ADMIN', record: await prisma.adminWithdrawal.findUnique({ where: { id: adminWithdrawal.id } }) };
  }

  return null;
};

// Hubtel reports send-money outcomes as 'success' / 'failed' (anything else is still in progress)
const outcomeFrom = (status) => {
  const value = String(status || '').toLowerCase();
  if (['success', 'paid', 'completed'].includes(value)) return 'SUCCESS';
  if (['failed', 'failure', 'cancelled', 'canceled', 'reversed'].includes(value)) return 'FAILED';
  return 'PENDING';
};

/**
 * Confirms a payout with Hubtel and records the outcome. Never trusts a callback body.
 *
 * @param {string} clientReference - Reference sent to Hubtel (record id without dashes)
 * @param {object} [options]
 * @param {object} [options.req] - Express request, for activity log context
 * @returns {Promise<{ handled: boolean, outcome?: string, type?: string, id?: string, reason?: string }>}
 */
export const settlePayoutByReference = async (clientReference, { req } = {}) => {
  const match = await findByReference(clientReference);
  if (!match || !match.record) {
    return { handled: false, reason: 'No payout found for this reference' };
  }

  const { type, record } = match;
  const inProgress = type === 'AFFILIATE'
    ? record.status === 'PROCESSING'
    : record.status === 'PROCESSING';

  if (!inProgress) {
    return { handled: false, outcome: 'ALREADY_SETTLED', type, id: record.id, reason: `Already recorded as ${record.status}` };
  }

  const statusInfo = await checkHubtelPayoutStatus(clientReference);
  if (!statusInfo.success) {
    return { handled: false, type, id: record.id, reason: statusInfo.error || 'Status check failed' };
  }

  const outcome = outcomeFrom(statusInfo.status);
  if (outcome === 'PENDING') {
    return { handled: false, outcome, type, id: record.id, reason: `Hubtel still reports ${statusInfo.status}` };
  }

  if (type === 'AFFILIATE') {
    await prisma.withdrawalRequest.updateMany({
      where: { id: record.id, status: 'PROCESSING' },
      data: {
        status: outcome === 'SUCCESS' ? 'APPROVED' : 'FAILED',
        adminNote: outcome === 'SUCCESS'
          ? `Payout confirmed by Hubtel [transaction: ${statusInfo.transactionId || 'n/a'}]`
          : `Payout failed at Hubtel (${statusInfo.status})`,
        processedAt: new Date()
      }
    });
  } else {
    await prisma.adminWithdrawal.updateMany({
      where: { id: record.id, status: 'PROCESSING' },
      data: {
        status: outcome === 'SUCCESS' ? 'COMPLETED' : 'FAILED',
        transactionRef: statusInfo.transactionId || clientReference,
        failureReason: outcome === 'FAILED' ? `Payout failed at Hubtel (${statusInfo.status})` : null
      }
    });
  }

  logActivity({
    action: outcome === 'SUCCESS' ? 'PAYOUT_CONFIRMED' : 'PAYOUT_FAILED',
    details: { type, recordId: record.id, amount: Number(record.amount), hubtelStatus: statusInfo.status },
    req
  });

  if (outcome === 'FAILED') {
    notifyAllAdmins({
      title: 'Payout failed',
      message: `A ${type === 'AFFILIATE' ? 'affiliate withdrawal' : 'direct withdrawal'} of GHS ${Number(record.amount).toFixed(2)} failed at Hubtel and was marked FAILED.`,
      type: 'SYSTEM',
      sendPush: true
    }).catch((err) => console.error('Failed to notify admins of failed payout:', err));
  }

  return { handled: true, outcome, type, id: record.id };
};

/**
 * Checks every payout still marked as in progress. Runs on a schedule so a missed callback
 * never leaves a payout in limbo, and so failures are noticed.
 */
export const reconcileInFlightPayouts = async () => {
  try {
    const [withdrawals, adminWithdrawals] = await Promise.all([
      prisma.withdrawalRequest.findMany({ where: { status: 'PROCESSING' }, select: { id: true } }),
      prisma.adminWithdrawal.findMany({ where: { status: 'PROCESSING' }, select: { id: true } })
    ]);

    const all = [...withdrawals, ...adminWithdrawals];
    if (all.length === 0) {
      console.log('[CRON] No in-flight payouts to reconcile.');
      return;
    }

    console.log(`[CRON] Reconciling ${all.length} in-flight payout(s)...`);

    for (const { id } of all) {
      const result = await settlePayoutByReference(referenceFor(id));
      console.log(`[CRON] Payout ${id}: ${result.handled ? result.outcome : `not settled (${result.reason})`}`);
    }
  } catch (error) {
    console.error('[CRON ERROR] Error in reconcileInFlightPayouts job:', error);
  }
};
