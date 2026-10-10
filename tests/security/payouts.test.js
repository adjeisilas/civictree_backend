/**
 * Security regression tests for money leaving the business:
 * affiliate withdrawals, admin direct withdrawals and partner settlements.
 *
 *   TEST_DATABASE_URL="mysql://root:testpass@127.0.0.1:33306/civictree_test" npm run test:security
 */
import { hubtel, prisma, startApp, resetDatabase, uniqueIp, HUBTEL_IP, OUTSIDER_IP } from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const { default: authRouter } = await import('../../routes/auth/authRoutes.js');
const { default: affiliatePortalRouter } = await import('../../routes/affiliate/affiliateRoutes.js');
const { default: adminAffiliateRouter } = await import('../../routes/admin/affiliateRoutes.js');
const { default: payoutRouter } = await import('../../routes/public/payoutRoutes.js');
const { reconcileInFlightPayouts, referenceFor } = await import('../../utils/payment/payoutReconciler.js');
const { PAYOUT_DETAILS_HOLD_MS } = await import('../../utils/affiliate/affiliateBalance.js');

let app;

const PASSWORD = 'Correct-Horse-42';

const createAdmin = async () => {
  const admin = await prisma.user.create({
    data: {
      fullName: 'Admin User',
      email: `admin-${crypto.randomUUID()}@example.com`,
      role: 'ADMIN',
      password: await bcrypt.hash(PASSWORD, 4),
      firstTimeLogin: false
    }
  });
  const login = await app.request('POST', '/api/auth/login', { body: { email: admin.email, password: PASSWORD }, ip: uniqueIp() });
  return { admin, token: login.body.data.accessToken };
};

const createAffiliate = async ({ commission = 100 } = {}) => {
  const user = await prisma.user.create({
    data: {
      fullName: 'Affiliate User',
      email: `aff-${crypto.randomUUID()}@example.com`,
      phoneNumber: `024${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
      role: 'AFFILIATE',
      password: await bcrypt.hash(PASSWORD, 4),
      firstTimeLogin: false
    }
  });
  const profile = await prisma.affiliateProfile.create({
    data: {
      userId: user.id,
      affiliateCode: `AFF-${crypto.randomBytes(3).toString('hex')}`,
      status: 'APPROVED',
      payoutMethod: 'MOBILE_MONEY',
      momoNetwork: 'MTN',
      momoNumber: '0241234567',
      momoAccountName: 'Affiliate User'
    }
  });

  if (commission > 0) {
    const order = await prisma.order.create({
      data: {
        id: `#CT-AFF-${crypto.randomBytes(4).toString('hex')}`,
        phoneNumber: '0209999999',
        voucherType: 'BECE',
        quantity: 1,
        amount: 20,
        channel: 'USSD',
        paymentStatus: 'SUCCESS',
        deliveryStatus: 'SENT',
        affiliateId: profile.id
      }
    });
    await prisma.affiliateCommission.create({
      data: { affiliateId: profile.id, orderId: order.id, voucherType: 'BECE', amount: commission }
    });
  }

  const login = await app.request('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD }, ip: uniqueIp() });
  return { user, profile, token: login.body.data.accessToken };
};

before(async () => {
  app = await startApp([
    ['/api/auth', authRouter],
    ['/api/affiliate', affiliatePortalRouter],
    ['/api/admin/affiliates', adminAffiliateRouter],
    ['/api/payouts', payoutRouter]
  ]);
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  hubtel.reset();
  await resetDatabase();
  await prisma.affiliateConfig.create({
    data: { wassceNovdecCommission: 2, beceCommission: 1.5, minWithdrawalAmount: 10, dailyWithdrawalCap: 1000 }
  });
});

describe('affiliate withdrawal requests', () => {
  it('cannot request more than the available balance', async () => {
    const { token } = await createAffiliate({ commission: 50 });

    const res = await app.request('POST', '/api/affiliate/withdrawals', { token, body: { amount: 80 } });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Insufficient available balance/);
    assert.equal(await prisma.withdrawalRequest.count(), 0);
  });

  it('cannot overdraw with simultaneous requests', async () => {
    const { token } = await createAffiliate({ commission: 100 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => app.request('POST', '/api/affiliate/withdrawals', { token, body: { amount: 60 } }))
    );

    assert.equal(results.filter((r) => r.status === 201).length, 1);
    const requested = await prisma.withdrawalRequest.aggregate({ _sum: { amount: true } });
    assert.equal(Number(requested._sum.amount || 0), 60);
  });

  it('counts payouts in progress as already spent', async () => {
    const { profile, token } = await createAffiliate({ commission: 100 });
    await prisma.withdrawalRequest.create({
      data: { affiliateId: profile.id, amount: 70, payoutMethod: 'MOBILE_MONEY', accountDetails: '{}', status: 'PROCESSING' }
    });

    const res = await app.request('POST', '/api/affiliate/withdrawals', { token, body: { amount: 50 } });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /GHS 30\.00/);
  });
});

describe('changing payout details', () => {
  it('requires the account password', async () => {
    const { profile, token } = await createAffiliate();

    const res = await app.request('PATCH', '/api/affiliate/profile/payment', {
      token,
      body: { payoutMethod: 'MOBILE_MONEY', momoNetwork: 'MTN', momoNumber: '0209999999', momoAccountName: 'Attacker' }
    });

    assert.equal(res.status, 400);
    const unchanged = await prisma.affiliateProfile.findUnique({ where: { id: profile.id } });
    assert.equal(unchanged.momoNumber, '0241234567');
  });

  it('rejects a wrong password without changing anything', async () => {
    const { profile, token } = await createAffiliate();

    const res = await app.request('PATCH', '/api/affiliate/profile/payment', {
      token,
      body: {
        payoutMethod: 'MOBILE_MONEY', momoNetwork: 'MTN', momoNumber: '0209999999', momoAccountName: 'Attacker',
        currentPassword: 'not-the-password'
      }
    });

    assert.equal(res.status, 401);
    const unchanged = await prisma.affiliateProfile.findUnique({ where: { id: profile.id } });
    assert.equal(unchanged.momoNumber, '0241234567');
  });

  it('warns the old number and holds withdrawals for 48 hours', async () => {
    const { profile, token } = await createAffiliate({ commission: 100 });

    const change = await app.request('PATCH', '/api/affiliate/profile/payment', {
      token,
      body: {
        payoutMethod: 'MOBILE_MONEY', momoNetwork: 'MTN', momoNumber: '0209999999', momoAccountName: 'New Name',
        currentPassword: PASSWORD
      }
    });
    assert.equal(change.status, 200);

    const updated = await prisma.affiliateProfile.findUnique({ where: { id: profile.id } });
    assert.equal(updated.momoNumber, '0209999999');
    assert.ok(updated.payoutDetailsUpdatedAt);
    assert.ok(hubtel.sms.some((sms) => sms.To === '233241234567' && /payout details were just changed/.test(sms.Content)));

    const blocked = await app.request('POST', '/api/affiliate/withdrawals', { token, body: { amount: 50 } });
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.message, /on hold/);

    // Once the hold has passed, withdrawals work again
    await prisma.affiliateProfile.update({
      where: { id: profile.id },
      data: { payoutDetailsUpdatedAt: new Date(Date.now() - PAYOUT_DETAILS_HOLD_MS - 1000) }
    });
    const allowed = await app.request('POST', '/api/affiliate/withdrawals', { token, body: { amount: 50 } });
    assert.equal(allowed.status, 201);
  });
});

describe('approving affiliate withdrawals', () => {
  const createPendingWithdrawal = async (affiliateId, amount = 50) =>
    prisma.withdrawalRequest.create({
      data: {
        affiliateId,
        amount,
        payoutMethod: 'MOBILE_MONEY',
        accountDetails: JSON.stringify({ method: 'MOBILE_MONEY', network: 'MTN', number: '0241234567', accountName: 'Affiliate User' }),
        status: 'PENDING'
      }
    });

  it('pays out only once when approved twice at the same time', async () => {
    const { token } = await createAdmin();
    const { profile } = await createAffiliate({ commission: 100 });
    const withdrawal = await createPendingWithdrawal(profile.id);

    const results = await Promise.all([
      app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, { token, body: { status: 'APPROVED' } }),
      app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, { token, body: { status: 'APPROVED' } })
    ]);

    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(hubtel.payouts.length, 1);
    assert.equal(hubtel.payouts[0].ClientReference, referenceFor(withdrawal.id));
  });

  it('waits for Hubtel to confirm before marking the payout approved', async () => {
    const { token } = await createAdmin();
    const { profile } = await createAffiliate({ commission: 100 });
    const withdrawal = await createPendingWithdrawal(profile.id);

    const res = await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, { token, body: { status: 'APPROVED' } });
    assert.equal(res.status, 200);
    assert.equal((await prisma.withdrawalRequest.findUnique({ where: { id: withdrawal.id } })).status, 'PROCESSING');

    // Hubtel confirms the transfer
    hubtel.payoutStatuses.set(referenceFor(withdrawal.id), 'success');
    await reconcileInFlightPayouts();

    assert.equal((await prisma.withdrawalRequest.findUnique({ where: { id: withdrawal.id } })).status, 'APPROVED');
  });

  it('marks the request FAILED when Hubtel rejects the transfer', async () => {
    const { token } = await createAdmin();
    const { profile } = await createAffiliate({ commission: 100 });
    const withdrawal = await createPendingWithdrawal(profile.id);
    hubtel.failPayout = true;

    const res = await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, { token, body: { status: 'APPROVED' } });

    assert.equal(res.status, 400);
    assert.equal((await prisma.withdrawalRequest.findUnique({ where: { id: withdrawal.id } })).status, 'FAILED');
  });

  it('releases the money again when a payout fails at Hubtel later', async () => {
    const { token } = await createAdmin();
    const { profile } = await createAffiliate({ commission: 100 });
    const withdrawal = await createPendingWithdrawal(profile.id);

    await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, { token, body: { status: 'APPROVED' } });
    hubtel.payoutStatuses.set(referenceFor(withdrawal.id), 'failed');
    await reconcileInFlightPayouts();

    assert.equal((await prisma.withdrawalRequest.findUnique({ where: { id: withdrawal.id } })).status, 'FAILED');
  });
});

describe('payout callbacks', () => {
  it('are rejected when they do not come from Hubtel', async () => {
    const res = await app.request('POST', '/api/payouts/webhook', { body: { ClientReference: 'anything' }, ip: OUTSIDER_IP });
    assert.equal(res.status, 403);
  });

  it('do not mark a payout successful on the callback body alone', async () => {
    const { token } = await createAdmin();
    const { profile } = await createAffiliate({ commission: 100 });
    const withdrawal = await prisma.withdrawalRequest.create({
      data: {
        affiliateId: profile.id, amount: 50, payoutMethod: 'MOBILE_MONEY',
        accountDetails: JSON.stringify({ method: 'MOBILE_MONEY', network: 'MTN', number: '0241234567', accountName: 'Affiliate User' }),
        status: 'PENDING'
      }
    });
    await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, { token, body: { status: 'APPROVED' } });

    // Hubtel's status API still says the transfer failed, whatever the callback claims
    hubtel.payoutStatuses.set(referenceFor(withdrawal.id), 'failed');
    const res = await app.request('POST', '/api/payouts/webhook', {
      body: { ResponseCode: '0000', Data: { ClientReference: referenceFor(withdrawal.id) } },
      ip: HUBTEL_IP
    });

    assert.equal(res.status, 200);
    assert.equal((await prisma.withdrawalRequest.findUnique({ where: { id: withdrawal.id } })).status, 'FAILED');
  });
});

describe('admin direct withdrawals', () => {
  const payoutBody = (overrides = {}) => ({
    amount: 100,
    payoutMethod: 'MOBILE_MONEY',
    momoNetwork: 'MTN',
    momoNumber: '0241234567',
    momoAccountName: 'Admin Person',
    currentPassword: PASSWORD,
    ...overrides
  });

  it('require the admin password', async () => {
    const { token } = await createAdmin();

    const missing = await app.request('POST', '/api/admin/affiliates/withdrawals/direct', { token, body: payoutBody({ currentPassword: undefined }) });
    assert.equal(missing.status, 400);

    const wrong = await app.request('POST', '/api/admin/affiliates/withdrawals/direct', { token, body: payoutBody({ currentPassword: 'wrong-password' }) });
    assert.equal(wrong.status, 401);

    assert.equal(hubtel.payouts.length, 0);
    assert.equal(await prisma.adminWithdrawal.count(), 0);
  });

  it('records the payout before sending it, and keeps it in progress until confirmed', async () => {
    const { token } = await createAdmin();

    const res = await app.request('POST', '/api/admin/affiliates/withdrawals/direct', { token, body: payoutBody() });

    assert.equal(res.status, 200);
    const record = await prisma.adminWithdrawal.findFirst();
    assert.equal(record.status, 'PROCESSING');
    assert.equal(hubtel.payouts[0].ClientReference, referenceFor(record.id));

    hubtel.payoutStatuses.set(referenceFor(record.id), 'success');
    await reconcileInFlightPayouts();
    assert.equal((await prisma.adminWithdrawal.findUnique({ where: { id: record.id } })).status, 'COMPLETED');
  });

  it('records a failed transfer instead of losing it', async () => {
    const { token } = await createAdmin();
    hubtel.failPayout = true;

    const res = await app.request('POST', '/api/admin/affiliates/withdrawals/direct', { token, body: payoutBody() });

    assert.equal(res.status, 400);
    const record = await prisma.adminWithdrawal.findFirst();
    assert.equal(record.status, 'FAILED');
    assert.match(record.failureReason, /./);
  });
});
