import { prisma } from './config/config.js';
import { sendHubtelPayout } from './utils/payment/hubtelHelper.js';
import { sendBatchSMS } from './utils/sms/smsHelper.js';
import { sendEmail } from './utils/email/email.js';

async function runRealYesterdayPartnerSettlement() {
  console.log('===========================================================');
  console.log('--- STARTING REAL YESTERDAY PARTNER SETTLEMENT DISBURSEMENT ---');
  console.log('===========================================================');

  // 1. Calculate Yesterday's 24-hour date range in Ghana Time (Africa/Accra / GMT)
  const now = new Date();
  const accraFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const todayStr = accraFormatter.format(now); // YYYY-MM-DD
  const todayParts = todayStr.split('-').map(Number);
  const todayUtc = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]));
  const yesterdayUtc = new Date(todayUtc);
  yesterdayUtc.setUTCDate(yesterdayUtc.getUTCDate() - 1);
  const yesterdayStr = yesterdayUtc.toISOString().slice(0, 10);

  const yesterdayStart = new Date(`${yesterdayStr}T00:00:00.000Z`);
  const yesterdayEnd = new Date(`${yesterdayStr}T23:59:59.999Z`);

  console.log(`📅 Target Date (Yesterday Ghana Time): ${yesterdayStr}`);
  console.log(`   Start: ${yesterdayStart.toISOString()}`);
  console.log(`   End  : ${yesterdayEnd.toISOString()}`);

  // 2. Fetch Partner Account
  const partner = await prisma.partner.findFirst({
    where: {
      OR: [
        { email: 'partner@civictreegh.com' },
        { phone: '0599745043' }
      ]
    },
    include: { payoutAccounts: true }
  });

  if (!partner) {
    console.error('❌ Partner account (BOATENG OWUSU / 0599745043) not found in database.');
    process.exit(1);
  }

  console.log(`✔ Partner Account Found: ${partner.partnerName} (${partner.phone})`);

  // 3. Fetch successful platform orders created ONLY YESTERDAY
  const yesterdayOrders = await prisma.order.findMany({
    where: {
      paymentStatus: 'SUCCESS',
      createdAt: { gte: yesterdayStart, lte: yesterdayEnd }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`✔ Total Successful Platform Orders Yesterday (${yesterdayStr}): ${yesterdayOrders.length}`);

  // 4. Ensure PartnerTransaction entries exist for yesterday's successful orders
  let newAccruedCount = 0;
  let newAccruedVouchers = 0;

  for (const order of yesterdayOrders) {
    const existingTx = await prisma.partnerTransaction.findFirst({
      where: { partnerId: partner.id, orderId: order.id }
    });

    if (!existingTx) {
      const perVoucherCut = 1.00;
      const partnerEarning = perVoucherCut * order.quantity;
      const unitPrice = order.quantity > 0 ? Number(order.amount) / order.quantity : Number(order.amount);
      const netMargin = Math.max(1, unitPrice - 15);
      const dynamicSharePercentage = parseFloat(((perVoucherCut / netMargin) * 100).toFixed(2));

      await prisma.partnerTransaction.create({
        data: {
          partnerId: partner.id,
          orderId: order.id,
          orderRef: order.id,
          voucherType: order.voucherType,
          quantity: order.quantity,
          unitPrice: unitPrice,
          grossAmount: order.amount,
          partnerPercentage: dynamicSharePercentage,
          partnerEarning: partnerEarning,
          channel: order.channel === 'USSD' ? 'USSD *713*5912#' : 'Web Direct',
          paymentMethod: 'Mobile Money',
          settlementStatus: 'Accrued',
          createdAt: order.createdAt
        }
      });

      newAccruedCount++;
      newAccruedVouchers += order.quantity;
    }
  }

  if (newAccruedCount > 0) {
    console.log(`✔ Created ${newAccruedCount} missing PartnerTransaction entries for ${newAccruedVouchers} vouchers sold yesterday.`);
  }

  // 5. Fetch unsettled (Accrued) PartnerTransactions for YESTERDAY
  const accruedTxs = await prisma.partnerTransaction.findMany({
    where: {
      partnerId: partner.id,
      settlementStatus: 'Accrued',
      createdAt: { gte: yesterdayStart, lte: yesterdayEnd }
    }
  });

  const totalVouchersToSettle = accruedTxs.reduce((sum, tx) => sum + tx.quantity, 0);
  const payoutAmount = parseFloat((totalVouchersToSettle * 1.00).toFixed(2));

  console.log('----------------------------------------------------');
  console.log(`Yesterday's Unsettled Vouchers Count : ${totalVouchersToSettle}`);
  console.log(`Yesterday's Calculated Payout Amount : GHS ${payoutAmount.toFixed(2)} (${totalVouchersToSettle} x GHS 1.00)`);
  console.log('----------------------------------------------------');

  if (payoutAmount <= 0) {
    console.log(`ℹ No pending partner earnings found for yesterday (${yesterdayStr}). Exiting cleanly.`);
    process.exit(0);
  }

  const defaultAccount = partner.payoutAccounts[0] || {
    accountNumber: partner.phone,
    accountName: partner.partnerName,
    provider: 'MTN Mobile Money'
  };

  const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  const cleanDateStr = yesterdayStr.replace(/[^a-zA-Z0-9]/g, '');
  const reference = `PAY${cleanDateStr}${randomCode}`;

  // 6. Create Settlement Log Entry in DB
  const settlement = await prisma.partnerSettlement.create({
    data: {
      partnerId: partner.id,
      reference,
      amount: payoutAmount,
      fee: 0.00,
      netAmount: payoutAmount,
      payoutMethod: 'MOMO',
      provider: defaultAccount.provider || 'MTN Mobile Money',
      destinationAccount: defaultAccount.accountNumber || partner.phone,
      accountName: defaultAccount.accountName || partner.partnerName,
      status: 'Processing',
      notes: `Real settlement disbursement for yesterday's sales (${yesterdayStr}): ${totalVouchersToSettle} vouchers`
    }
  });

  console.log(`🚀 Initiating REAL Hubtel MoMo payout of GHS ${payoutAmount.toFixed(2)} to ${defaultAccount.accountNumber} (${defaultAccount.accountName}) for date ${yesterdayStr}...`);

  let payoutSuccess = false;
  let responseData = null;

  try {
    const hubtelRes = await sendHubtelPayout({
      recipientName: defaultAccount.accountName || partner.partnerName,
      recipientNumber: defaultAccount.accountNumber || partner.phone,
      amount: payoutAmount,
      payoutMethod: 'MOBILE_MONEY',
      channel: defaultAccount.provider || 'MTN Mobile Money',
      clientReference: reference,
      description: `CivicTree Yesterday Partner Settlement (${yesterdayStr}) - ${totalVouchersToSettle} vouchers`
    });

    payoutSuccess = hubtelRes.success;
    responseData = hubtelRes.data;
    console.log('✔ Hubtel Payout Response:', hubtelRes);
  } catch (hubtelErr) {
    console.error('❌ Hubtel Payout Execution Failed:', hubtelErr.message);
  }

  const finalStatus = payoutSuccess ? 'Completed' : 'Pending';

  // 7. Update PartnerSettlement Record
  await prisma.partnerSettlement.update({
    where: { id: settlement.id },
    data: {
      status: finalStatus,
      processedAt: payoutSuccess ? new Date() : null,
      notes: payoutSuccess ? `Disbursed successfully via Hubtel (${reference})` : `Payout pending / failed: ${responseData ? JSON.stringify(responseData) : 'Hubtel response error'}`
    }
  });

  if (payoutSuccess) {
    await prisma.partner.update({
      where: { id: partner.id },
      data: {
        withdrawnAmount: { increment: payoutAmount },
        availableBalance: { decrement: payoutAmount }
      }
    });

    const txIds = accruedTxs.map(t => t.id);
    if (txIds.length > 0) {
      await prisma.partnerTransaction.updateMany({
        where: { id: { in: txIds } },
        data: { settlementStatus: 'Settled' }
      });
    }

    console.log(`✅ DISBURSEMENT SUCCESSFUL: GHS ${payoutAmount.toFixed(2)} sent to ${partner.partnerName} (${defaultAccount.accountNumber}).`);
  } else {
    console.log(`⚠️ DISBURSEMENT PENDING: Settlement recorded as Pending. Reference: ${reference}`);
  }

  // 8. Dispatch Stakeholder SMS & Email Alerts
  const smsMessage = `CivicTree: Partner revenue settlement for yesterday (${yesterdayStr}) of GHS ${payoutAmount.toFixed(2)} for ${totalVouchersToSettle} vouchers has been processed to ${partner.partnerName} (${defaultAccount.accountNumber}). Status: ${finalStatus}. Ref: ${reference}`;
  const stakeholderPhones = ['0257581661', '0550807914', '233240897702'];

  console.log('📱 Sending SMS alerts to stakeholders...');
  await sendBatchSMS({ recipients: stakeholderPhones, message: smsMessage });

  const stakeholderEmails = ['joshuaasemani27@gmail.com', 'afriyieanthony013@gmail.com', 'owusuboat05@gmail.com'];
  const emailSubject = `[CivicTree] Yesterday Partner Revenue Settlement Report - GHS ${payoutAmount.toFixed(2)} (${finalStatus})`;
  const emailHtml = `
    <h2>CivicTree Partner Revenue Settlement Report (Yesterday's Sales)</h2>
    <p>Dear Stakeholder,</p>
    <p>This is an automated report confirming the partner revenue settlement for yesterday's sales (<strong>${yesterdayStr}</strong>).</p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
      <tr><td><strong>Target Date</strong></td><td>${yesterdayStr} (Ghana Time)</td></tr>
      <tr><td><strong>Partner Name</strong></td><td>${partner.partnerName}</td></tr>
      <tr><td><strong>Destination Account</strong></td><td>${defaultAccount.accountNumber} (${defaultAccount.provider})</td></tr>
      <tr><td><strong>Yesterday Vouchers Sold</strong></td><td>${totalVouchersToSettle}</td></tr>
      <tr><td><strong>Rate Per Voucher</strong></td><td>GHS 1.00</td></tr>
      <tr><td><strong>Total Payout Amount</strong></td><td><strong>GHS ${payoutAmount.toFixed(2)}</strong></td></tr>
      <tr><td><strong>Settlement Status</strong></td><td>${finalStatus}</td></tr>
      <tr><td><strong>Transaction Reference</strong></td><td>${reference}</td></tr>
      <tr><td><strong>Timestamp</strong></td><td>${new Date().toLocaleString('en-US', { timeZone: 'Africa/Accra' })} (Ghana Time)</td></tr>
    </table>
    <br/>
    <p>Regards,<br/><strong>CivicTree Settlement Engine</strong></p>
  `;

  console.log('📧 Sending Email alerts to stakeholders...');
  for (const email of stakeholderEmails) {
    await sendEmail({ to: email, subject: emailSubject, html: emailHtml }).catch(e => console.error(`Failed email to ${email}:`, e.message));
  }

  console.log('===========================================================');
  console.log('--- YESTERDAY PARTNER SETTLEMENT DISBURSEMENT FINISHED ---');
  console.log('===========================================================');
}

runRealYesterdayPartnerSettlement()
  .catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
