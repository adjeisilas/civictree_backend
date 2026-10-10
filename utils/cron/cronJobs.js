import cron from 'node-cron';
import { prisma } from '../../config/config.js';
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

    // 2. Count current AVAILABLE vouchers for each type
    const [wassceNovdecCount, beceCount] = await Promise.all([
      prisma.voucher.count({ where: { type: 'WASSCE_NOVDEC', status: 'AVAILABLE' } }),
      prisma.voucher.count({ where: { type: 'BECE', status: 'AVAILABLE' } })
    ]);

    const now = new Date();
    const updates = {};
    const alertTypes = [];

    // Check WASSCE_NOVDEC
    if (wassceNovdecCount <= voucherConfig.wassceNovdecLimit) {
      const lastAlerted = voucherConfig.wassceNovdecLastAlertedAt;
      if (!lastAlerted || (now - new Date(lastAlerted)) >= COOLDOWN_MS) {
        alertTypes.push({
          type: 'WASSCE_NOVDEC',
          count: wassceNovdecCount,
          limit: voucherConfig.wassceNovdecLimit
        });
        updates.wassceNovdecLastAlertedAt = now;
      }
    }

    // Check BECE
    if (beceCount <= voucherConfig.beceLimit) {
      const lastAlerted = voucherConfig.beceLastAlertedAt;
      if (!lastAlerted || (now - new Date(lastAlerted)) >= COOLDOWN_MS) {
        alertTypes.push({
          type: 'BECE',
          count: beceCount,
          limit: voucherConfig.beceLimit
        });
        updates.beceLastAlertedAt = now;
      }
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

        const checkLink = order.voucherType === 'BECE' ? 'https://eresults.waecgh.org/' : 'https://ghana.waecdirect.org/';
        const smsMessage = `CivicTree: Thank you! Order: ${order.id}.\n\n Here are your ${order.voucherType} voucher codes:\n${voucherListStr}\nCheck results here: ${checkLink}`;

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

// /**
//  * Executes automated daily revenue-share partner settlement at 11:59:59 PM.
//  * Calculates total vouchers sold today, creates settlement record, and dispatches payout via Hubtel Send Money API.
//  */
// export const processDailyPartnerSettlement = async () => {
//   try {
//     console.log('[CRON 11:59:59 PM] Starting daily revenue-share partner settlement processing...');

//     const activePartners = await prisma.partner.findMany({
//       where: { status: 'Active' },
//       include: {
//         payoutAccounts: {
//           where: { isDefault: true }
//         }
//       }
//     });

//     if (activePartners.length === 0) {
//       console.log('[CRON 11:59:59 PM] No active partners found for settlement.');
//       return;
//     }

//     // Calculate today's date range explicitly in Ghana Time (Africa/Accra / GMT)
//     const now = new Date();
//     const accraDateFormatter = new Intl.DateTimeFormat('en-CA', {
//       timeZone: 'Africa/Accra',
//       year: 'numeric',
//       month: '2-digit',
//       day: '2-digit'
//     });
//     const dateStr = accraDateFormatter.format(now); // YYYY-MM-DD
//     const todayStart = new Date(`${dateStr}T00:00:00.000Z`);
//     const todayEnd = new Date(`${dateStr}T23:59:59.999Z`);

//     for (const partner of activePartners) {
//       try {
//         // Aggregate accrued transactions for today that have not been settled
//         const accruedTxs = await prisma.partnerTransaction.findMany({
//           where: {
//             partnerId: partner.id,
//             settlementStatus: 'Accrued',
//             createdAt: { gte: todayStart, lte: todayEnd }
//           }
//         });

//         const totalVouchersToday = accruedTxs.reduce((sum, tx) => sum + tx.quantity, 0);
//         const perVoucherRate = 1.00; // Fixed GHS 1.00 per voucher
//         const dailyPayoutAmount = parseFloat((totalVouchersToday * perVoucherRate).toFixed(2));

//         if (dailyPayoutAmount <= 0) {
//           console.log(`[CRON 11:55 PM GHANA] Partner ${partner.partnerName} (${partner.partnerId}) had 0 voucher sales today. Skipping payout.`);
//           continue;
//         }

//         const defaultAccount = partner.payoutAccounts[0] || {
//           accountNumber: partner.phone,
//           accountName: partner.partnerName,
//           provider: 'MTN Mobile Money'
//         };

//         const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
//         const cleanDateStr = dateStr.replace(/[^a-zA-Z0-9]/g, '');
//         const reference = `PAY${cleanDateStr}${randomCode}`;

//         // Create settlement log entry in DB
//         const settlement = await prisma.partnerSettlement.create({
//           data: {
//             partnerId: partner.id,
//             reference,
//             amount: dailyPayoutAmount,
//             fee: 0.00,
//             netAmount: dailyPayoutAmount,
//             payoutMethod: 'MOMO',
//             provider: defaultAccount.provider || 'MTN Mobile Money',
//             destinationAccount: defaultAccount.accountNumber || partner.phone,
//             accountName: defaultAccount.accountName || partner.partnerName,
//             status: 'Processing',
//             notes: `Automated daily settlement for ${totalVouchersToday} vouchers sold on ${dateStr}`
//           }
//         });

//         console.log(`[CRON 11:55 PM GHANA] Triggering Hubtel MoMo payout of GHS ${dailyPayoutAmount} to ${defaultAccount.accountNumber}...`);

//         let payoutSuccess = false;
//         try {
//           const hubtelRes = await sendHubtelPayout({
//             recipientName: defaultAccount.accountName || partner.partnerName,
//             recipientNumber: defaultAccount.accountNumber || partner.phone,
//             amount: dailyPayoutAmount,
//             payoutMethod: 'MOBILE_MONEY',
//             channel: defaultAccount.provider || 'MTN Mobile Money',
//             clientReference: reference,
//             description: `CivicTree Daily Partner Revenue Settlement - ${totalVouchersToday} vouchers`
//           });
//           payoutSuccess = hubtelRes.success;
//         } catch (hubtelErr) {
//           console.error(`[CRON 11:55 PM GHANA HUBTEL PAYOUT ERROR] For partner ${partner.partnerName}:`, hubtelErr.message);
//         }

//         const finalStatus = payoutSuccess ? 'Completed' : 'Pending';

//         // Update settlement record
//         await prisma.partnerSettlement.update({
//           where: { id: settlement.id },
//           data: {
//             status: finalStatus,
//             processedAt: payoutSuccess ? new Date() : null
//           }
//         });

//         // Update partner balances
//         await prisma.partner.update({
//           where: { id: partner.id },
//           data: {
//             withdrawnAmount: { increment: dailyPayoutAmount },
//             availableBalance: { decrement: dailyPayoutAmount }
//           }
//         });

//         // Mark today's transactions as Settled
//         const txIds = accruedTxs.map(t => t.id);
//         if (txIds.length > 0) {
//           await prisma.partnerTransaction.updateMany({
//             where: { id: { in: txIds } },
//             data: { settlementStatus: 'Settled' }
//           });
//         }

//         // Send Partner In-App Notification
//         await prisma.partnerNotification.create({
//           data: {
//             partnerId: partner.id,
//             title: `Daily Revenue Settlement (${finalStatus})`,
//             message: `Your daily settlement of GHS ${dailyPayoutAmount.toFixed(2)} for ${totalVouchersToday} vouchers sold today has been processed to ${defaultAccount.accountNumber}.`,
//             type: 'PAYOUT_STATUS',
//             link: '/partner/settlements'
//           }
//         });

//         // Send SMS notifications to stakeholders
//         const smsMessage = `CivicTree: Daily Partner revenue settlement of GHS ${dailyPayoutAmount.toFixed(2)} for ${totalVouchersToday} vouchers sold today has been processed to ${partner.partnerName} (${defaultAccount.accountNumber}). Ref: ${reference}`;
//         const stakeholderPhones = ['0257581661', '0550807914', '233240897702'];

//         sendBatchSMS({ recipients: stakeholderPhones, message: smsMessage }).catch(err =>
//           console.error('[CRON 11:55 PM SMS ERROR] Failed to send stakeholder settlement SMS:', err)
//         );

//         // Send Email notifications to stakeholders
//         const stakeholderEmails = ['joshuaasemani27@gmail.com', 'afriyieanthony013@gmail.com', 'owusuboat05@gmail.com'];
//         const emailSubject = `[CivicTree] Daily Partner Revenue Settlement Disbursed - GHS ${dailyPayoutAmount.toFixed(2)}`;
//         const emailHtml = `
//           <h2>CivicTree Daily Partner Revenue Settlement Report</h2>
//           <p>Dear Stakeholder,</p>
//           <p>This is an automated report confirming that the daily revenue settlement for <strong>${partner.partnerName}</strong> has been processed.</p>
//           <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
//             <tr><td><strong>Partner Name</strong></td><td>${partner.partnerName}</td></tr>
//             <tr><td><strong>Destination MoMo Number</strong></td><td>${defaultAccount.accountNumber} (${defaultAccount.provider})</td></tr>
//             <tr><td><strong>Total Vouchers Sold Today</strong></td><td>${totalVouchersToday}</td></tr>
//             <tr><td><strong>Contract Share Rate</strong></td><td>GHS 1.00 per voucher</td></tr>
//             <tr><td><strong>Total Disbursed Amount</strong></td><td><strong>GHS ${dailyPayoutAmount.toFixed(2)}</strong></td></tr>
//             <tr><td><strong>Settlement Status</strong></td><td>${finalStatus}</td></tr>
//             <tr><td><strong>Transaction Reference</strong></td><td>${reference}</td></tr>
//             <tr><td><strong>Timestamp</strong></td><td>${new Date().toLocaleString('en-US', { timeZone: 'Africa/Accra' })} (Ghana Time)</td></tr>
//           </table>
//           <br/>
//           <p>Regards,<br/><strong>CivicTree Automated Settlement Engine</strong></p>
//         `;

//         for (const recipientEmail of stakeholderEmails) {
//           sendEmail({ to: recipientEmail, subject: emailSubject, html: emailHtml }).catch(err =>
//             console.error(`[CRON 11:55 PM EMAIL ERROR] Failed to send settlement email to ${recipientEmail}:`, err)
//           );
//         }

//         console.log(`[CRON 11:55 PM GHANA SUCCESS] Completed daily settlement & notifications for ${partner.partnerName}: GHS ${dailyPayoutAmount}`);
//       } catch (partnerErr) {
//         console.error(`[CRON 11:55 PM GHANA ERROR] Error settling partner ${partner.partnerId}:`, partnerErr);
//       }
//     }
//   } catch (error) {
//     console.error('[CRON 11:55 PM GHANA ERROR] Error in processDailyPartnerSettlement job:', error);
//   }
// };

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

