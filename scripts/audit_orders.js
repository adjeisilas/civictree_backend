/**
 * READ-ONLY audit: finds orders that were fulfilled (paymentStatus = SUCCESS)
 * without a matching confirmed payment on Hubtel.
 *
 * It never changes the database. It writes a CSV report and prints a summary.
 * Voucher PINs are never read or printed.
 *
 * Must run from a server whose IP is whitelisted on Hubtel (the production API host),
 * otherwise every status check fails with 403.
 *
 * Usage:
 *   node scripts/audit_orders.js                     # all SUCCESS orders
 *   node scripts/audit_orders.js --since 2026-08-01  # only orders created on/after this date
 *   node scripts/audit_orders.js --out ./audit.csv   # custom report path
 */
import fs from 'fs';
import { prisma } from '../config/config.js';
import { checkHubtelTransactionStatus } from '../utils/payment/hubtelHelper.js';

const DELAY_BETWEEN_CHECKS_MS = 300;
const AMOUNT_TOLERANCE = 0.01;

const getArg = (name) => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

async function run() {
  const since = getArg('--since');
  const outPath = getArg('--out') || `./order_audit_${new Date().toISOString().slice(0, 10)}.csv`;

  if (since && isNaN(new Date(since).getTime())) {
    throw new Error(`Invalid --since date: ${since}`);
  }

  const priceConfig = await prisma.voucherConfig.findFirst();
  const currentUnitPrice = {
    BECE: priceConfig ? Number(priceConfig.becePrice) : null,
    WASSCE_NOVDEC: priceConfig ? Number(priceConfig.wassceNovdecPrice) : null
  };

  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: 'SUCCESS',
      ...(since ? { createdAt: { gte: new Date(since) } } : {})
    },
    select: {
      id: true,
      phoneNumber: true,
      voucherType: true,
      quantity: true,
      amount: true,
      channel: true,
      deliveryStatus: true,
      transactionId: true,
      affiliateId: true,
      createdAt: true,
      _count: { select: { vouchers: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Auditing ${orders.length} SUCCESS orders${since ? ` since ${since}` : ''}...`);

  const rows = [];
  const totals = { ok: 0, notPaid: 0, amountMismatch: 0, unverifiable: 0, underpriced: 0, voucherCountMismatch: 0 };
  let lostValue = 0;

  for (const [index, order] of orders.entries()) {
    const orderAmount = Number(order.amount);
    const issues = [];

    // 1. Ask Hubtel what really happened to this payment
    const hubtel = await checkHubtelTransactionStatus(order.id);
    let verdict;
    if (!hubtel.success) {
      verdict = 'UNVERIFIABLE';
      totals.unverifiable++;
    } else if (hubtel.status !== 'Paid') {
      verdict = 'NOT_PAID';
      totals.notPaid++;
      lostValue += orderAmount;
    } else if (Math.abs(Number(hubtel.amount) - orderAmount) > AMOUNT_TOLERANCE) {
      verdict = 'AMOUNT_MISMATCH';
      totals.amountMismatch++;
      lostValue += Math.max(0, orderAmount - Number(hubtel.amount));
    } else {
      verdict = 'OK';
      totals.ok++;
    }

    // 2. Order priced below today's unit price (possible forged USSD price; prices may also have changed since)
    const unitPrice = currentUnitPrice[order.voucherType];
    if (unitPrice !== null && orderAmount + AMOUNT_TOLERANCE < unitPrice * order.quantity) {
      issues.push(`amount below current price (${(unitPrice * order.quantity).toFixed(2)})`);
      totals.underpriced++;
    }

    // 3. Vouchers attached do not match quantity ordered
    if (order._count.vouchers !== order.quantity) {
      issues.push(`vouchers attached ${order._count.vouchers} != quantity ${order.quantity}`);
      totals.voucherCountMismatch++;
    }

    if (verdict !== 'OK' || issues.length > 0) {
      rows.push({
        orderId: order.id,
        createdAt: order.createdAt.toISOString(),
        channel: order.channel,
        voucherType: order.voucherType,
        quantity: order.quantity,
        orderAmount: orderAmount.toFixed(2),
        hubtelStatus: hubtel.success ? hubtel.status : `ERROR: ${hubtel.error}`,
        hubtelAmount: hubtel.success ? hubtel.amount : '',
        verdict,
        otherIssues: issues.join('; '),
        phoneNumber: order.phoneNumber,
        affiliateId: order.affiliateId || '',
        deliveryStatus: order.deliveryStatus,
        transactionId: order.transactionId || ''
      });
    }

    if ((index + 1) % 25 === 0) {
      console.log(`  checked ${index + 1}/${orders.length}`);
    }
    await sleep(DELAY_BETWEEN_CHECKS_MS);
  }

  const headers = [
    'orderId', 'createdAt', 'channel', 'voucherType', 'quantity', 'orderAmount', 'hubtelStatus',
    'hubtelAmount', 'verdict', 'otherIssues', 'phoneNumber', 'affiliateId', 'deliveryStatus', 'transactionId'
  ];
  const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(','))].join('\n');
  fs.writeFileSync(outPath, csv);

  console.log('\n=== Order audit summary ===');
  console.log(`Orders checked:                 ${orders.length}`);
  console.log(`Confirmed paid, amount matches: ${totals.ok}`);
  console.log(`NOT PAID on Hubtel:             ${totals.notPaid}`);
  console.log(`Paid amount mismatch:           ${totals.amountMismatch}`);
  console.log(`Could not verify (API error):   ${totals.unverifiable}`);
  console.log(`Priced below current price:     ${totals.underpriced}`);
  console.log(`Voucher count mismatch:         ${totals.voucherCountMismatch}`);
  console.log(`Estimated unpaid value (GHS):   ${lostValue.toFixed(2)}`);
  console.log(`Flagged rows written to:        ${outPath}`);
  if (totals.unverifiable > 0) {
    console.log('\nNote: USSD orders paid through Hubtel\'s own checkout (AddToCart) may not be found by');
    console.log('client reference. Cross-check UNVERIFIABLE rows against the Hubtel merchant dashboard.');
  }
}

run()
  .catch((err) => {
    console.error('Order audit failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
