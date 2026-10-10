import { prisma } from '../../config/config.js';
import { notifyAllAdmins } from '../notification/pushHelper.js';
import { logger } from '../logger.js';

/**
 * Watches for signs that something is wrong — an attack, a broken integration, or a mistake —
 * and tells the admins. Runs on a schedule (see initCronJobs).
 *
 * Every check covers the last WINDOW_MS only, so alerts describe what is happening now.
 */
const WINDOW_MS = 60 * 60 * 1000; // one hour

// Alert when a count in the window goes above these
const THRESHOLDS = {
  forgedCallbacks: 1, // any unconfirmed "payment succeeded" callback is worth knowing about
  amountMismatches: 1,
  failedLogins: 25,
  failedPayouts: 1,
  pinReveals: 20,
  payoutTotalGhs: Number(process.env.PAYOUT_ALERT_THRESHOLD_GHS || 5000)
};

const countActivity = (action, since) =>
  prisma.activityLog.count({ where: { action, createdAt: { gte: since } } });

/**
 * Runs the checks and notifies admins about anything over its threshold.
 * @returns {Promise<Array<{ title: string, detail: string }>>} The alerts raised
 */
export const runSecurityChecks = async () => {
  const since = new Date(Date.now() - WINDOW_MS);
  const alerts = [];

  try {
    const [
      forgedCallbacks,
      amountMismatches,
      pinReveals,
      failedPayouts,
      twoFactorFailures,
      recoveryCodeUses
    ] = await Promise.all([
      countActivity('ORDER_PAYMENT_CALLBACK_UNCONFIRMED', since),
      countActivity('ORDER_PAYMENT_AMOUNT_MISMATCH', since),
      countActivity('VOUCHER_PIN_REVEALED', since),
      countActivity('AFFILIATE_WITHDRAWAL_PAYOUT_FAILED', since),
      countActivity('USER_2FA_FAILED', since),
      countActivity('USER_2FA_RECOVERY_CODE_USED', since)
    ]);

    // 1. Someone claimed a payment succeeded and Hubtel did not confirm it
    if (forgedCallbacks >= THRESHOLDS.forgedCallbacks) {
      alerts.push({
        title: 'Unconfirmed payment callbacks',
        detail: `${forgedCallbacks} callback(s) claimed a successful payment that Hubtel did not confirm in the last hour. No vouchers were released, but someone may be probing the payment endpoints.`
      });
    }

    // 2. Paid less than the order total
    if (amountMismatches >= THRESHOLDS.amountMismatches) {
      alerts.push({
        title: 'Payment amount mismatches',
        detail: `${amountMismatches} order(s) were paid with the wrong amount in the last hour and were not fulfilled.`
      });
    }

    // 3. Vouchers marked sold without a confirmed payment (should never happen)
    const fulfilledWithoutPayment = await prisma.voucher.count({
      where: {
        status: 'SOLD',
        updatedAt: { gte: since },
        order: { paymentStatus: { not: 'SUCCESS' } }
      }
    });
    if (fulfilledWithoutPayment > 0) {
      alerts.push({
        title: 'Vouchers released without a successful payment',
        detail: `${fulfilledWithoutPayment} voucher(s) are attached to an order that is not marked as paid. Investigate immediately.`
      });
    }

    // 4. Password guessing
    const failedLogins = await prisma.user.aggregate({
      _sum: { failedLoginAttempts: true },
      where: { failedLoginAttempts: { gt: 0 } }
    });
    const lockedAccounts = await prisma.user.count({ where: { lockedUntil: { gte: new Date() } } });
    if (Number(failedLogins._sum.failedLoginAttempts || 0) >= THRESHOLDS.failedLogins || lockedAccounts > 0) {
      alerts.push({
        title: 'Failed login attempts',
        detail: `${failedLogins._sum.failedLoginAttempts || 0} failed login attempt(s) are recorded against accounts, and ${lockedAccounts} account(s) are currently locked.`
      });
    }

    // 5. Two-factor trouble
    if (twoFactorFailures >= 10 || recoveryCodeUses > 0) {
      alerts.push({
        title: 'Two-step verification activity',
        detail: `${twoFactorFailures} rejected code(s) and ${recoveryCodeUses} recovery code use(s) in the last hour.`
      });
    }

    // 6. Money out: unusual totals or failures
    const [payoutTotal, failedWithdrawals] = await Promise.all([
      prisma.withdrawalRequest.aggregate({
        _sum: { amount: true },
        where: { status: { in: ['PROCESSING', 'APPROVED'] }, processedAt: { gte: since } }
      }),
      prisma.withdrawalRequest.count({ where: { status: 'FAILED', updatedAt: { gte: since } } })
    ]);

    const paidOut = Number(payoutTotal._sum.amount || 0);
    if (paidOut >= THRESHOLDS.payoutTotalGhs) {
      alerts.push({
        title: 'High payout volume',
        detail: `GHS ${paidOut.toFixed(2)} of withdrawals were processed in the last hour, above the alert level of GHS ${THRESHOLDS.payoutTotalGhs.toFixed(2)}.`
      });
    }
    if (failedPayouts + failedWithdrawals >= THRESHOLDS.failedPayouts) {
      alerts.push({
        title: 'Failed payouts',
        detail: `${failedPayouts + failedWithdrawals} payout(s) failed in the last hour. Check them against Hubtel before retrying.`
      });
    }

    // 7. Unusual number of PIN reveals by admins
    if (pinReveals >= THRESHOLDS.pinReveals) {
      alerts.push({
        title: 'Many voucher PINs revealed',
        detail: `${pinReveals} voucher PIN(s) were revealed by admins in the last hour.`
      });
    }

    // 8. Orders stuck waiting for payment confirmation
    const stuckOrders = await prisma.order.count({
      where: { paymentStatus: 'PENDING', createdAt: { lt: new Date(Date.now() - 2 * WINDOW_MS) } }
    });
    if (stuckOrders >= 25) {
      alerts.push({
        title: 'Many orders stuck as pending',
        detail: `${stuckOrders} order(s) have been pending for more than two hours. Hubtel status checks may be failing (check that the server IP is still whitelisted).`
      });
    }

    for (const alert of alerts) {
      logger.warn('security alert', { title: alert.title, detail: alert.detail });
      await notifyAllAdmins({
        title: `Security alert: ${alert.title}`,
        message: alert.detail,
        type: 'SYSTEM',
        sendPush: true
      }).catch((err) => logger.error('failed to send security alert', { error: err.message }));
    }

    if (alerts.length === 0) {
      logger.info('security checks clear', { windowMinutes: WINDOW_MS / 60000 });
    }

    return alerts;
  } catch (error) {
    logger.error('security checks failed', { error });
    return alerts;
  }
};
