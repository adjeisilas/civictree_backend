/**
 * Security regression tests for payments, fulfillment and USSD.
 *
 * Each test replays an attack that used to work (forged callbacks, forged USSD state, races)
 * and checks it no longer does. Hubtel is simulated at the HTTP layer; nothing leaves the machine.
 *
 * Needs a THROWAWAY MySQL database — every table used here is wiped before each test:
 *   TEST_DATABASE_URL="mysql://root:testpass@127.0.0.1:33306/civictree_test" npm run test:security
 */
import {
  hubtel,
  prisma,
  config,
  startApp,
  resetDatabase,
  activityActions,
  HUBTEL_IP,
  OUTSIDER_IP,
  BECE_PRICE,
  WASSCE_PRICE
} from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { default: orderRouter } = await import('../../routes/public/orderRoutes.js');
const { default: ussdRouter } = await import('../../routes/public/ussdRoutes.js');
const { default: affiliateUssdRouter } = await import('../../routes/public/affiliateUssdRoutes.js');
const { completeOrderFulfillment } = await import('../../controllers/public/orderController.js');
const { reconcilePendingPayments } = await import('../../utils/cron/cronJobs.js');

let app;

const post = (path, body, ip = HUBTEL_IP) => app.post(path, body, ip);

// ---- Data helpers -----------------------------------------------------------
const seedVouchers = async (type, count) => {
  await prisma.voucher.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      type,
      serialNumber: `${type}-${crypto.randomUUID()}`,
      pin: `PIN-${i}-${crypto.randomBytes(3).toString('hex')}`
    }))
  });
};

const createPendingOrder = (overrides = {}) => prisma.order.create({
  data: {
    id: `#CT-TEST-${crypto.randomBytes(4).toString('hex')}`,
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

const countVouchers = (where) => prisma.voucher.count({ where });

const ussdStep = (path, { sessionId, mobile, type = 'Response', message, clientState }, ip = HUBTEL_IP) =>
  post(path, {
    Type: type,
    Message: message,
    ClientState: clientState,
    Mobile: mobile,
    SessionId: sessionId,
    Operator: 'mtn'
  }, ip);

// ---- Lifecycle --------------------------------------------------------------
before(async () => {
  app = await startApp([
    ['/api/orders', orderRouter],
    ['/api/ussd', ussdRouter],
    ['/api/ussd/affiliate', affiliateUssdRouter]
  ]);
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  hubtel.reset();
  config.hubtel.callbackToken = null;
  await resetDatabase();
});

// ---- Tests ------------------------------------------------------------------
describe('web checkout', () => {
  it('rejects orders above the per-order limit', async () => {
    await seedVouchers('BECE', 30);
    const res = await post('/api/orders', { voucherType: 'BECE', quantity: 21, phoneNumber: '0241234567' });
    assert.equal(res.status, 400);
    assert.equal(await prisma.order.count(), 0);
  });

  it('creates an order and returns the amount to be charged', async () => {
    await seedVouchers('BECE', 3);
    const res = await post('/api/orders', { voucherType: 'BECE', quantity: 2, phoneNumber: '0241234567' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.amount, 2 * BECE_PRICE);
    const order = await prisma.order.findUnique({ where: { id: res.body.data.orderId } });
    assert.equal(Number(order.amount), 2 * BECE_PRICE);
    assert.match(order.id, /^#CT-\d+-[0-9A-F]{8}$/);
  });
});

describe('payment webhook', () => {
  it('rejects callbacks that do not come from Hubtel', async () => {
    await seedVouchers('BECE', 1);
    const order = await createPendingOrder();
    hubtel.statuses.set(order.id, { status: 'Paid', amount: BECE_PRICE });

    const res = await post('/api/orders/webhook', { ClientReference: order.id, ResponseCode: '0000' }, OUTSIDER_IP);

    assert.equal(res.status, 403);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'PENDING');
  });

  it('does not fulfil a forged success callback', async () => {
    await seedVouchers('BECE', 1);
    const order = await createPendingOrder();
    hubtel.statuses.set(order.id, { status: 'Unpaid', amount: BECE_PRICE });

    const res = await post('/api/orders/webhook', { ClientReference: order.id, ResponseCode: '0000', Status: 'Success' });

    assert.equal(res.status, 200);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'PENDING');
    assert.equal(await countVouchers({ status: 'AVAILABLE' }), 1);
    assert.equal(hubtel.sms.length, 0);
    assert.ok((await activityActions('ORDER_PAYMENT_CALLBACK_UNCONFIRMED')).includes('ORDER_PAYMENT_CALLBACK_UNCONFIRMED'));
  });

  it('does not fail a pending order on a forged failure callback', async () => {
    const order = await createPendingOrder();
    hubtel.statuses.set(order.id, { status: 'Unpaid', amount: BECE_PRICE });

    await post('/api/orders/webhook', { ClientReference: order.id, ResponseCode: '2001', Status: 'Failed' });

    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'PENDING');
  });

  it('fulfils the order when Hubtel confirms the payment', async () => {
    await seedVouchers('BECE', 2);
    const order = await createPendingOrder();
    hubtel.statuses.set(order.id, { status: 'Paid', amount: BECE_PRICE });

    const res = await post('/api/orders/webhook', { ClientReference: order.id, ResponseCode: '0000' });

    assert.equal(res.status, 200);
    const updated = await prisma.order.findUnique({ where: { id: order.id }, include: { vouchers: true } });
    assert.equal(updated.paymentStatus, 'SUCCESS');
    assert.equal(updated.deliveryStatus, 'SENT');
    assert.equal(updated.vouchers.length, 1);
    assert.equal(hubtel.sms.length, 1);
    assert.equal(hubtel.sms[0].To, '233241234567');
    assert.ok(hubtel.sms[0].Content.includes(updated.vouchers[0].pin));
  });

  it('refuses to fulfil an underpaid order', async () => {
    await seedVouchers('BECE', 1);
    const order = await createPendingOrder();
    hubtel.statuses.set(order.id, { status: 'Paid', amount: 0.5 });

    await post('/api/orders/webhook', { ClientReference: order.id, ResponseCode: '0000' });

    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'FAILED');
    assert.equal(await countVouchers({ status: 'AVAILABLE' }), 1);
    assert.ok((await activityActions('ORDER_PAYMENT_AMOUNT_MISMATCH')).includes('ORDER_PAYMENT_AMOUNT_MISMATCH'));
  });

  it('leaves the order pending when Hubtel cannot confirm either way', async () => {
    await seedVouchers('BECE', 1);
    const order = await createPendingOrder(); // no status registered -> status check fails

    await post('/api/orders/webhook', { ClientReference: order.id, ResponseCode: '0000' });

    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'PENDING');
    assert.equal(await countVouchers({ status: 'AVAILABLE' }), 1);
  });

  it('requires the callback token when one is configured', async () => {
    await seedVouchers('BECE', 1);
    const order = await createPendingOrder();
    hubtel.statuses.set(order.id, { status: 'Paid', amount: BECE_PRICE });
    config.hubtel.callbackToken = 'tok-0123456789';

    assert.equal((await post('/api/orders/webhook', { ClientReference: order.id })).status, 403);
    assert.equal((await post('/api/orders/webhook/wrong-token', { ClientReference: order.id })).status, 403);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'PENDING');

    const res = await post('/api/orders/webhook/tok-0123456789', { ClientReference: order.id });
    assert.equal(res.status, 200);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'SUCCESS');
  });
});

describe('concurrent fulfillment', () => {
  it('fulfils an order only once when called many times at once', async () => {
    await seedVouchers('BECE', 5);
    const order = await createPendingOrder({ quantity: 2, amount: 2 * BECE_PRICE });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => completeOrderFulfillment({ orderId: order.id, transactionId: null }))
    );

    assert.equal(results.filter((r) => r.fulfilled).length, 1);
    assert.equal(await countVouchers({ orderId: order.id }), 2);
    assert.equal(await countVouchers({ status: 'SOLD' }), 2);
    assert.equal(hubtel.sms.length, 1);
  });

  it('never gives the same voucher to two orders', async () => {
    await seedVouchers('BECE', 4);
    const orders = await Promise.all(Array.from({ length: 4 }, () => createPendingOrder()));

    const results = await Promise.all(
      orders.map((order) => completeOrderFulfillment({ orderId: order.id, transactionId: null }))
    );

    assert.equal(results.filter((r) => r.fulfilled && !r.outOfStock).length, 4);
    const vouchers = await prisma.voucher.findMany();
    assert.equal(vouchers.filter((v) => v.status === 'SOLD').length, 4);
    assert.equal(new Set(vouchers.map((v) => v.orderId)).size, 4);
  });

  it('marks the losing orders out of stock when stock runs short', async () => {
    await seedVouchers('BECE', 3);
    const orders = await Promise.all(
      Array.from({ length: 3 }, () => createPendingOrder({ quantity: 2, amount: 2 * BECE_PRICE }))
    );

    const results = await Promise.all(
      orders.map((order) => completeOrderFulfillment({ orderId: order.id, transactionId: null }))
    );

    assert.equal(results.filter((r) => r.fulfilled && !r.outOfStock).length, 1);
    assert.equal(results.filter((r) => r.outOfStock).length, 2);
    assert.equal(await countVouchers({ status: 'SOLD' }), 2);
    assert.equal(await prisma.order.count({ where: { deliveryStatus: 'FAILED', paymentStatus: 'SUCCESS' } }), 2);
  });
});

describe('main USSD menu', () => {
  const path = '/api/ussd/interaction';

  it('rejects USSD requests that do not come from Hubtel', async () => {
    const res = await ussdStep(path, { sessionId: 's-out', mobile: '233241234567', type: 'Initiation', message: '*713#' }, OUTSIDER_IP);
    assert.equal(res.status, 403);
  });

  it('ignores a forged confirmation state and its price', async () => {
    await seedVouchers('BECE', 20);
    const res = await ussdStep(path, {
      sessionId: 's-forged',
      mobile: '233241234567',
      message: '1',
      clientState: 'CONFIRM:BECE:10:0.01'
    });

    assert.equal(res.body.Type, 'response');
    assert.match(res.body.ClientState, /^SELECT_OPTION~/);
    assert.equal(await prisma.order.count(), 0);
  });

  it('rejects a signed state that was altered', async () => {
    await seedVouchers('BECE', 20);
    const session = { sessionId: 's-tamper', mobile: '233241234567' };
    const menu = await ussdStep(path, { ...session, type: 'Initiation', message: '*713#' });
    const confirm = await ussdStep(path, { ...session, message: '1', clientState: menu.body.ClientState });
    assert.match(confirm.body.ClientState, /^CONFIRM:BECE:1~/);

    const tampered = confirm.body.ClientState.replace('CONFIRM:BECE:1~', 'CONFIRM:BECE:9~');
    const res = await ussdStep(path, { ...session, message: '1', clientState: tampered });

    assert.match(res.body.ClientState, /^SELECT_OPTION~/);
    assert.equal(await prisma.order.count(), 0);
  });

  it('rejects a state replayed from another session', async () => {
    await seedVouchers('BECE', 1);
    const menu = await ussdStep(path, { sessionId: 's-a', mobile: '233241234567', type: 'Initiation', message: '*713#' });
    const confirm = await ussdStep(path, { sessionId: 's-a', mobile: '233241234567', message: '1', clientState: menu.body.ClientState });

    const res = await ussdStep(path, { sessionId: 's-b', mobile: '233241234567', message: '1', clientState: confirm.body.ClientState });

    assert.match(res.body.ClientState, /^SELECT_OPTION~/);
    assert.equal(await prisma.order.count(), 0);
  });

  it('charges the configured price for a genuine purchase', async () => {
    await seedVouchers('WASSCE_NOVDEC', 1);
    const session = { sessionId: 's-genuine', mobile: '233241234567' };
    const menu = await ussdStep(path, { ...session, type: 'Initiation', message: '*713#' });
    const confirm = await ussdStep(path, { ...session, message: '2', clientState: menu.body.ClientState });
    const pay = await ussdStep(path, { ...session, message: '1', clientState: confirm.body.ClientState });

    assert.equal(pay.body.Type, 'AddToCart');
    assert.equal(pay.body.Item.Price, WASSCE_PRICE);
    const order = await prisma.order.findFirst();
    assert.equal(Number(order.amount), WASSCE_PRICE);
    assert.equal(order.transactionId, session.sessionId);
    assert.equal(hubtel.directDebits[0].Amount, WASSCE_PRICE);
  });

  it("does not reveal another customer's vouchers", async () => {
    await seedVouchers('BECE', 1);
    const victimOrder = await createPendingOrder({ phoneNumber: '0209999999' });
    hubtel.statuses.set(victimOrder.id, { status: 'Paid', amount: BECE_PRICE });
    await completeOrderFulfillment({ orderId: victimOrder.id, transactionId: null });

    const attacker = { sessionId: 's-attacker', mobile: '233241111111' };
    const menu = await ussdStep(path, { ...attacker, type: 'Initiation', message: '*713#' });
    const list = await ussdStep(path, { ...attacker, message: '3', clientState: menu.body.ClientState });
    assert.equal(list.body.Type, 'release');
    assert.match(list.body.Message, /No transactions found/);

    const forged = await ussdStep(path, { ...attacker, message: '1', clientState: `TX_SELECT:${victimOrder.id}` });
    assert.doesNotMatch(forged.body.Message, /PIN/);

    // The real owner can still see them
    const owner = { sessionId: 's-owner', mobile: '233209999999' };
    const ownerMenu = await ussdStep(path, { ...owner, type: 'Initiation', message: '*713#' });
    const ownerList = await ussdStep(path, { ...owner, message: '3', clientState: ownerMenu.body.ClientState });
    const ownerView = await ussdStep(path, { ...owner, message: '1', clientState: ownerList.body.ClientState });
    assert.match(ownerView.body.Message, /PIN/);
  });
});

describe('USSD fulfillment', () => {
  const path = '/api/ussd/fulfillment';

  it('does not fulfil a forged "Paid" fulfillment request', async () => {
    await seedVouchers('BECE', 1);
    const order = await createPendingOrder({ channel: 'USSD', transactionId: 'sess-forged', phoneNumber: '233241234567' });
    hubtel.statuses.set(order.id, { status: 'Unpaid', amount: BECE_PRICE });
    hubtel.statuses.set('sess-forged', { status: 'Unpaid', amount: BECE_PRICE });

    const res = await post(path, { SessionId: 'sess-forged', OrderId: 'hub-1', OrderInfo: { Status: 'Paid' } });

    assert.equal(res.status, 200);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'PENDING');
    assert.equal(await countVouchers({ status: 'AVAILABLE' }), 1);
    assert.equal(hubtel.ussdCallbacks.length, 0);
  });

  it('fulfils a paid USSD order and confirms it to Hubtel', async () => {
    await seedVouchers('BECE', 1);
    const order = await createPendingOrder({ channel: 'USSD', transactionId: 'sess-paid', phoneNumber: '233241234567' });
    hubtel.statuses.set('sess-paid', { status: 'Paid', amount: BECE_PRICE });

    const res = await post(path, { SessionId: 'sess-paid', OrderId: 'hub-2', OrderInfo: { Status: 'Paid' } });

    assert.equal(res.status, 200);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'SUCCESS');
    assert.deepEqual(
      hubtel.ussdCallbacks.map((c) => [c.SessionId, c.OrderId, c.ServiceStatus]),
      [['sess-paid', 'hub-2', 'success']]
    );
  });
});

describe('affiliate USSD', () => {
  const interaction = '/api/ussd/affiliate/interaction';
  const fulfillment = '/api/ussd/affiliate/fulfillment';

  const createAffiliate = async () => {
    const user = await prisma.user.create({
      data: { fullName: 'Test Affiliate', email: `aff-${crypto.randomUUID()}@example.com`, password: 'x', role: 'AFFILIATE' }
    });
    return prisma.affiliateProfile.create({
      data: { userId: user.id, affiliateCode: `AFF-${crypto.randomBytes(3).toString('hex')}`, ussdCode: '*713*001#', status: 'APPROVED' }
    });
  };

  it('ignores forged affiliate attribution', async () => {
    await seedVouchers('BECE', 1);
    const affiliate = await createAffiliate();

    const res = await ussdStep(interaction, {
      sessionId: 's-aff-forged',
      mobile: '233241234567',
      message: '1',
      clientState: `AFF:${affiliate.id}|CONFIRM:BECE:1`
    });

    assert.match(res.body.ClientState, /^SELECT_OPTION~/);
    assert.equal(await prisma.order.count(), 0);
  });

  it('credits commission exactly once for a paid affiliate sale', async () => {
    await seedVouchers('BECE', 2);
    const affiliate = await createAffiliate();
    const session = { sessionId: 's-aff-sale', mobile: '233241234567' };

    const menu = await ussdStep(interaction, { ...session, type: 'Initiation', message: '*713*001#' });
    assert.match(menu.body.ClientState, new RegExp(`^AFF:${affiliate.id}\\|SELECT_OPTION~`));
    const confirm = await ussdStep(interaction, { ...session, message: '1', clientState: menu.body.ClientState });
    const pay = await ussdStep(interaction, { ...session, message: '1', clientState: confirm.body.ClientState });
    assert.equal(pay.body.Type, 'AddToCart');

    const order = await prisma.order.findFirst();
    assert.equal(order.affiliateId, affiliate.id);
    hubtel.statuses.set(session.sessionId, { status: 'Paid', amount: BECE_PRICE });

    await Promise.all([
      post(fulfillment, { SessionId: session.sessionId, OrderId: 'hub-aff', OrderInfo: { Status: 'Paid' } }),
      completeOrderFulfillment({ orderId: order.id, transactionId: null })
    ]);
    await completeOrderFulfillment({ orderId: order.id, transactionId: null });

    const commissions = await prisma.affiliateCommission.findMany();
    assert.equal(commissions.length, 1);
    assert.equal(Number(commissions[0].amount), 1.5);
    const profile = await prisma.affiliateProfile.findUnique({ where: { id: affiliate.id } });
    assert.equal(profile.totalVouchersSold, 1);
    assert.equal(await countVouchers({ status: 'SOLD' }), 1);
  });
});

describe('payment reconciliation job', () => {
  it('settles pending orders only on Hubtel\'s word', async () => {
    await seedVouchers('BECE', 2);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const oldUnpaid = await createPendingOrder({ createdAt: threeHoursAgo });
    const recentUnpaid = await createPendingOrder({ createdAt: tenMinutesAgo });
    const refunded = await createPendingOrder({ createdAt: tenMinutesAgo });
    const paid = await createPendingOrder({ createdAt: tenMinutesAgo });
    const unreachable = await createPendingOrder({ createdAt: tenMinutesAgo });

    hubtel.statuses.set(oldUnpaid.id, { status: 'Unpaid', amount: BECE_PRICE });
    hubtel.statuses.set(recentUnpaid.id, { status: 'Unpaid', amount: BECE_PRICE });
    hubtel.statuses.set(refunded.id, { status: 'Refunded', amount: BECE_PRICE });
    hubtel.statuses.set(paid.id, { status: 'Paid', amount: BECE_PRICE });

    await reconcilePendingPayments();

    const statusOf = async (order) => (await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus;
    assert.equal(await statusOf(oldUnpaid), 'FAILED');
    assert.equal(await statusOf(recentUnpaid), 'PENDING');
    assert.equal(await statusOf(refunded), 'FAILED');
    assert.equal(await statusOf(paid), 'SUCCESS');
    assert.equal(await statusOf(unreachable), 'PENDING');
    assert.equal(await countVouchers({ status: 'SOLD' }), 1);
  });
});
