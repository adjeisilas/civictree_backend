import cron from 'node-cron';
import { prisma } from '../../config/config.js';
import { VOUCHER_TYPES, displayNameFor, limitFieldFor, lastAlertedFieldFor, resultsUrlFor } from '../voucher/voucherTypes.js';
import { createNotification, sendPushNotification } from '../notification/pushHelper.js';
import { sendEmail } from '../email/email.js';
import { sendSMS, sendBatchSMS } from '../sms/smsHelper.js';
import { sendHubtelPayout } from '../payment/hubtelHelper.js';
import { verifyOrderPayment } from '../payment/verifyOrderPayment.js';
import { reconcileInFlightPayouts } from '../payment/payoutReconciler.js';
import { readPin } from '../voucher/voucherPin.js';
import { runSecurityChecks } from './securityMonitor.js';
import { applyPaymentVerification } from '../../controllers/public/orderController.js';


const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours alert rate limiting
const UNPAID_ORDER_EXPIRY_MS = 2 * 60 * 60 * 1000; // Unpaid orders older than 2 hours are marked FAILED

/**
 * Checks stock levels and sends alerts if any voucher type is running low.
 */
export const checkVoucherStock = async () => {
  try {
    console.log('[CRON] Checking voucher stock levels...');

    // 1. Fetch the single configuration record
    const voucherConfig = await prisma.voucherConfig.findFirst();
    if (!voucherConfig) {
      console.log('[CRON] No voucher configuration found. Skipping stock check.');
      return;
    }

    // 2. Count current AVAILABLE vouchers, one query per type we sell
    const counts = Object.fromEntries(
      await Promise.all(
        VOUCHER_TYPES.map(async (type) => [
          type,
          await prisma.voucher.count({ where: { type, status: 'AVAILABLE' } })
        ])
      )
    );

    const now = new Date();
    const updates = {};
    const alertTypes = [];

    // Alert once per cooldown window per type, so a new type is never skipped
    for (const type of VOUCHER_TYPES) {
      const limit = voucherConfig[limitFieldFor(type)];
      if (counts[type] > limit) continue;

      const lastAlertedField = lastAlertedFieldFor(type);
      const lastAlerted = voucherConfig[lastAlertedField];
      if (lastAlerted && (now - new Date(lastAlerted)) < COOLDOWN_MS) continue;

      alertTypes.push({ type, count: counts[type], limit });
      updates[lastAlertedField] = now;
    }

    if (alertTypes.length === 0) {
      console.log('[CRON] Voucher stock levels are healthy. No alerts triggered.');
      return;
    }

    // 3. Find all active administrators
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true }
    });

    if (admins.length === 0) {
      console.log('[CRON] No active administrators found to alert.');
      return;
    }

    // 4. Send alerts to each admin for each triggered low-stock type
    for (const alert of alertTypes) {
      const message = `Low Stock Alert: ${alert.type} has only ${alert.count} vouchers left (limit is ${alert.limit}). Please restock!`;

      const alertPromises = admins.map(async (admin) => {
        try {
          // 4.1 Database Notification
          await createNotification({
            userId: admin.id,
            title: `Low Stock: ${alert.type}`,
            message: message,
            type: 'LOW_STOCK'
          });

          // 4.2 Send Web Push Notification
          await sendPushNotification(admin.id, {
            title: `Low Stock: ${alert.type}`,
            body: message,
            type: 'LOW_STOCK'
          });

          // 4.3 Send Email
          await sendEmail({
            to: admin.email,
            subject: `[ALERT] Low Voucher Stock - ${alert.type}`,
            html: `
              <h2>Low Stock Alert</h2>
              <p>Dear Admin (${admin.fullName}),</p>
              <p>This is an automated notification that the result checker voucher stock for <strong>${alert.type}</strong> is low.</p>
              <ul>
                <li><strong>Current Available Count:</strong> ${alert.count}</li>
                <li><strong>Configured Warning Threshold:</strong> ${alert.limit}</li>
              </ul>
              <p>Please log in to the admin dashboard and upload a new voucher batch to avoid service interruption.</p>
            `
          });

          // 4.4 Send SMS
          if (admin.phoneNumber) {
            await sendSMS({
              to: admin.phoneNumber,
              message: message
            });
          }
        } catch (adminErr) {
          console.error(`[CRON ERROR] Failed sending alert to admin ${admin.email}:`, adminErr);
        }
      });

      await Promise.all(alertPromises);
    }

    // 5. Update last alerted timestamps in DB to enforce rate limiting
    await prisma.voucherConfig.update({
      where: { id: voucherConfig.id },
      data: updates
    });

    console.log('[CRON] Low stock alerts successfully processed.');
  } catch (error) {
    console.error('[CRON ERROR] Error in checkVoucherStock job:', error);
  }
};

/**
 * Checks for completed orders with failed SMS delivery and retries them.
 */
export const resendFailedVoucherDeliveries = async () => {
  try {
    console.log('[CRON] Starting failed voucher SMS delivery retry job...');

    // Find all completed orders (payment SUCCESS) with delivery status FAILED
    const failedOrders = await prisma.order.findMany({
      where: {
        paymentStatus: 'SUCCESS',
        deliveryStatus: 'FAILED'
      },
      include: {
        vouchers: true
      }
    });

    if (failedOrders.length === 0) {
      console.log('[CRON] No failed voucher deliveries found to retry.');
      return;
    }

    console.log(`[CRON] Found ${failedOrders.length} failed order SMS deliveries. Retrying...`);

    for (const order of failedOrders) {
      try {
        if (order.vouchers.length === 0) {
          console.warn(`[CRON WARNING] Order ${order.id} is marked as successful but has no linked vouchers. Skipping SMS retry.`);
          continue;
        }

        const voucherListStr = order.vouchers
          .map((v, i) => `${i + 1}. Serial Number: ${v.serialNumber} PIN: ${readPin(v.pin)}`)
          .join('\n');

        const checkLink = resultsUrlFor(order.voucherType);
        const linkLine = checkLink ? `\nCheck results here: ${checkLink}` : '';
        const smsMessage = `CivicTree: Thank you! Order: ${order.id}.\n\n Here are your ${displayNameFor(order.voucherType)} voucher codes:\n${voucherListStr}${linkLine}`;

        console.log(`[CRON] Retrying SMS to ${order.phoneNumber} for order ${order.id}...`);

        const smsResult = await sendSMS({
          to: order.phoneNumber,
          message: smsMessage
        });

        if (smsResult.success) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              deliveryStatus: 'SENT'
            }
          });
          console.log(`[CRON SUCCESS] SMS re-delivered successfully for order ${order.id}.`);
        } else {
          console.error(`[CRON ERROR] SMS re-delivery failed again for order ${order.id}:`, smsResult.error);
        }
      } catch (orderErr) {
        console.error(`[CRON ERROR] Failed processing retry for order ${order.id}:`, orderErr);
      }
    }
  } catch (error) {
    console.error('[CRON ERROR] Error in resendFailedVoucherDeliveries job:', error);
  }
};

/**
 * Periodically reconciles pending orders by checking payment status with Hubtel.
 */
export const reconcilePendingPayments = async () => {
  try {
    console.log('[CRON] Starting pending order payment reconciliation job...');

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Find orders that have been pending for more than 5 minutes but less than 24 hours
    const pendingOrders = await prisma.order.findMany({
      where: {
        paymentStatus: 'PENDING',
        createdAt: {
          gte: twentyFourHoursAgo,
          lte: fiveMinutesAgo
        }
      }
    });

    if (pendingOrders.length === 0) {
      console.log('[CRON] No pending orders found for reconciliation.');
      return;
    }

    console.log(`[CRON] Found ${pendingOrders.length} pending orders to reconcile.`);

    for (const order of pendingOrders) {
      try {
        const verification = await verifyOrderPayment(order);

        if (verification.outcome === 'UNKNOWN') {
          console.error(`[CRON ERROR] Failed to check status for order ${order.id}:`, verification.error);
          continue;
        }

        // Paid -> fulfill; amount mismatch or final non-paid status -> FAILED;
        // still Unpaid after 2 hours -> FAILED; otherwise leave PENDING for the next run.
        const result = await applyPaymentVerification({
          order,
          verification,
          req: null,
          source: 'CRON_RECONCILE',
          failUnpaidOlderThanMs: UNPAID_ORDER_EXPIRY_MS
        });

        console.log(`[CRON] Order ${order.id}: verification ${verification.outcome}, payment status ${result.paymentStatus}.`);
      } catch (orderErr) {
        console.error(`[CRON ERROR] Error reconciling order ${order.id}:`, orderErr);
      }
    }
  } catch (error) {
    console.error('[CRON ERROR] Error in reconcilePendingPayments job:', error);
  }
};

// The daily partner revenue settlement is disabled along with the partner
// portal. Its previous implementation is in git history.

/**
 * Initializes and schedules all cron jobs for the application.
 */
export const initCronJobs = () => {
  const cronOptions = { scheduled: true, timezone: 'Africa/Accra' };

  // Run every hour: '0 * * * *'
  cron.schedule('0 * * * *', checkVoucherStock, cronOptions);
  console.log('[CRON] Voucher stock monitor scheduled to run hourly (Africa/Accra).');

  // Run every 5 mins: '0/5 * * * *'
  cron.schedule('*/5 * * * *', resendFailedVoucherDeliveries, cronOptions);
  console.log('[CRON] Failed voucher SMS delivery retry job scheduled to run every 5 mins (Africa/Accra).');

  // Run every 5 minutes: '*/5 * * * *'
  // Callbacks are only fulfilled once Hubtel's status API confirms payment, so this job
  // picks up any payment the status API had not caught up with at callback time.
  cron.schedule('*/5 * * * *', reconcilePendingPayments, cronOptions);
  console.log('[CRON] Pending payments reconciliation job scheduled to run every 5 minutes (Africa/Accra).');

  // Run every 10 minutes: '*/10 * * * *'
  // Confirms payouts with Hubtel, so a missed callback never leaves money in limbo.
  cron.schedule('*/10 * * * *', reconcileInFlightPayouts, cronOptions);
  console.log('[CRON] Payout reconciliation job scheduled to run every 10 minutes (Africa/Accra).');

  // Run hourly: '15 * * * *'
  // Looks for signs of attack or breakage (forged callbacks, payout spikes, failed logins).
  cron.schedule('15 * * * *', runSecurityChecks, cronOptions);
  console.log('[CRON] Security monitoring job scheduled to run hourly (Africa/Accra).');

  // // Run daily at 11:55 PM Ghana Time (GMT): '55 23 * * *'
  // cron.schedule('55 23 * * *', processDailyPartnerSettlement, cronOptions);
  // console.log('[CRON] Partner daily 11:55 PM GMT (Africa/Accra) settlement job scheduled.');
};

