/**
 * Tests for the hourly security checks: they must raise an alert when something looks wrong,
 * and stay quiet when nothing does.
 *
 *   TEST_DATABASE_URL="mysql://root:testpass@127.0.0.1:33306/civictree_test" npm run test:security
 */
import { prisma, resetDatabase, BECE_PRICE } from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const { runSecurityChecks } = await import('../../utils/cron/securityMonitor.js');

const titles = (alerts) => alerts.map((alert) => alert.title);

const logAction = (action, count = 1) =>
  prisma.activityLog.createMany({
    data: Array.from({ length: count }, () => ({ action, details: '{}' }))
  });

const createOrder = (overrides = {}) => prisma.order.create({
  data: {
    id: `#CT-MON-${crypto.randomBytes(4).toString('hex')}`,
    phoneNumber: '0241234567',
    voucherType: 'BECE',
    quantity: 1,
    amount: BECE_PRICE,
    channel: 'WEB',
    paymentStatus: 'PENDING',
    deliveryStatus: 'NOT_SENT',
    ...overrides
  }
});

before(async () => {
  await resetDatabase();
});

after(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('hourly security checks', () => {
  it('stay quiet when nothing is wrong', async () => {
    const alerts = await runSecurityChecks();
    assert.deepEqual(alerts, []);
  });

  it('flag callbacks that claimed a payment Hubtel never confirmed', async () => {
    await logAction('ORDER_PAYMENT_CALLBACK_UNCONFIRMED', 2);

    const alerts = await runSecurityChecks();

    assert.ok(titles(alerts).includes('Unconfirmed payment callbacks'));
  });

  it('flag underpaid orders', async () => {
    await logAction('ORDER_PAYMENT_AMOUNT_MISMATCH');

    const alerts = await runSecurityChecks();

    assert.ok(titles(alerts).includes('Payment amount mismatches'));
  });

  it('flag a voucher attached to an unpaid order', async () => {
    const order = await createOrder({ paymentStatus: 'PENDING' });
    await prisma.voucher.create({
      data: { type: 'BECE', serialNumber: `SN-${crypto.randomUUID()}`, pin: 'x', status: 'SOLD', orderId: order.id }
    });

    const alerts = await runSecurityChecks();

    assert.ok(titles(alerts).includes('Vouchers released without a successful payment'));
  });

  it('stay quiet for vouchers on properly paid orders', async () => {
    const order = await createOrder({ paymentStatus: 'SUCCESS', deliveryStatus: 'SENT' });
    await prisma.voucher.create({
      data: { type: 'BECE', serialNumber: `SN-${crypto.randomUUID()}`, pin: 'x', status: 'SOLD', orderId: order.id }
    });

    const alerts = await runSecurityChecks();

    assert.ok(!titles(alerts).includes('Vouchers released without a successful payment'));
  });

  it('flag locked accounts and password guessing', async () => {
    await prisma.user.create({
      data: {
        fullName: 'Target', email: `target-${crypto.randomUUID()}@example.com`, role: 'ADMIN',
        password: await bcrypt.hash('x', 4), failedLoginAttempts: 30
      }
    });

    const alerts = await runSecurityChecks();

    assert.ok(titles(alerts).includes('Failed login attempts'));
  });

  it('flag failed payouts', async () => {
    const user = await prisma.user.create({
      data: { fullName: 'Aff', email: `aff-${crypto.randomUUID()}@example.com`, role: 'AFFILIATE', password: 'x' }
    });
    const profile = await prisma.affiliateProfile.create({
      data: { userId: user.id, affiliateCode: `AFF-${crypto.randomBytes(3).toString('hex')}`, status: 'APPROVED' }
    });
    await prisma.withdrawalRequest.create({
      data: { affiliateId: profile.id, amount: 50, payoutMethod: 'MOBILE_MONEY', accountDetails: '{}', status: 'FAILED' }
    });

    const alerts = await runSecurityChecks();

    assert.ok(titles(alerts).includes('Failed payouts'));
  });

  it('flag orders stuck waiting for payment confirmation', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await Promise.all(
      Array.from({ length: 25 }, () => createOrder({ createdAt: threeHoursAgo }))
    );

    const alerts = await runSecurityChecks();

    assert.ok(titles(alerts).includes('Many orders stuck as pending'));
  });
});
