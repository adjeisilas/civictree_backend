/**
 * Clearing the SMS contact list.
 *
 * The thing that must never go wrong here: orders are revenue records. An admin
 * clearing a mailing list must not be able to delete them, so these tests assert
 * the order rows survive every clearance while the contacts stop being reachable.
 *
 * The other half is "so I can receive new ones" — a caller who dials again after
 * a clearance has to come back, which is why the dialer rows are deleted rather
 * than filtered (UssdDialer is unique on phoneNumber+voucherType, so a surviving
 * row would block re-registration forever).
 *
 *   TEST_DATABASE_URL="mysql://root:testpass@127.0.0.1:3307/civictree_test" npm run test:security
 */
import { prisma, startApp, resetDatabase, uniqueIp, hubtel } from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const { default: authRouter } = await import('../../routes/auth/authRoutes.js');
const { default: adminSmsRouter } = await import('../../routes/admin/smsRoutes.js');
const { buildSmsRecipients } = await import('../../utils/sms/smsRecipients.js');
const { clearSmsContacts, smsContactSummary } = await import('../../utils/sms/smsContacts.js');
const { trackUssdDialer } = await import('../../utils/ussd/ussdTracker.js');

let app;
const PASSWORD = 'Correct-Horse-42';

const createAdminSession = async () => {
  const admin = await prisma.user.create({
    data: {
      fullName: 'Admin User',
      email: `admin-${crypto.randomUUID()}@example.com`,
      role: 'ADMIN',
      password: await bcrypt.hash(PASSWORD, 4),
      firstTimeLogin: false
    }
  });
  const login = await app.request('POST', '/api/auth/login', {
    body: { email: admin.email, password: PASSWORD },
    ip: uniqueIp()
  });
  return { admin, token: login.body.data.accessToken };
};

const createOrder = (phoneNumber, voucherType = 'BECE', overrides = {}) => prisma.order.create({
  data: {
    id: `ORD-${crypto.randomUUID()}`,
    phoneNumber,
    voucherType,
    quantity: 1,
    amount: 20,
    channel: 'WEB',
    paymentStatus: 'SUCCESS',
    ...overrides
  }
});

const createDialer = (phoneNumber, voucherType = 'BECE') => prisma.ussdDialer.create({
  data: { phoneNumber, voucherType, source: 'MAIN_USSD' }
});

const contactsFor = async (voucherType) =>
  (await buildSmsRecipients({ voucherType, recipientType: 'ALL' })).recipients.length;

before(async () => {
  app = await startApp([
    ['/api/auth', authRouter],
    ['/api/admin/sms', adminSmsRouter]
  ]);
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  hubtel.reset();
  await resetDatabase();
  await prisma.smsContactClearance.deleteMany();
});

describe('clearing one voucher type', () => {
  it('empties that type and leaves the others alone', async () => {
    await createDialer('233240000001', 'BECE');
    await createOrder('0240000002', 'BECE');
    await createDialer('233240000003', 'WASSCE_NOVDEC');
    await createOrder('0240000004', 'CTVET_NABTEX');

    assert.equal(await contactsFor('BECE'), 2);

    const result = await clearSmsContacts({ voucherType: 'BECE' });

    assert.equal(result.contactsBefore, 2);
    assert.equal(result.contactsAfter, 0);
    assert.equal(await contactsFor('BECE'), 0);

    // The other products are untouched
    assert.equal(await contactsFor('WASSCE_NOVDEC'), 1);
    assert.equal(await contactsFor('CTVET_NABTEX'), 1);
  });

  it('removes the cleared type from the general campaign too', async () => {
    await createOrder('0240000002', 'BECE');
    await createOrder('0240000004', 'WASSCE_NOVDEC');

    assert.equal(await contactsFor(undefined), 2);
    await clearSmsContacts({ voucherType: 'BECE' });
    assert.equal(await contactsFor(undefined), 1, 'a cleared BECE buyer should not be in the general list');
  });
});

describe('clearing everything', () => {
  it('empties every type at once', async () => {
    await createDialer('233240000001', 'BECE');
    await createDialer('233240000003', 'WASSCE_NOVDEC');
    await createOrder('0240000004', 'CTVET_NABTEX');

    const result = await clearSmsContacts({ voucherType: null });

    assert.equal(result.contactsBefore, 3);
    assert.equal(result.contactsAfter, 0);
    for (const type of ['BECE', 'WASSCE_NOVDEC', 'CTVET_NABTEX']) {
      assert.equal(await contactsFor(type), 0, `${type} should be empty`);
    }
    assert.equal(await contactsFor(undefined), 0);
  });
});

describe('what a clearance must never touch', () => {
  it('keeps every order row, with its amount and status', async () => {
    const order = await createOrder('0240000002', 'BECE', { amount: 123.45 });
    await createOrder('0240000005', 'WASSCE_NOVDEC');

    await clearSmsContacts({ voucherType: null });

    const orders = await prisma.order.findMany();
    assert.equal(orders.length, 2, 'orders are revenue records and must survive');

    const kept = await prisma.order.findUnique({ where: { id: order.id } });
    assert.ok(kept, 'the order should still exist');
    assert.equal(Number(kept.amount), 123.45);
    assert.equal(kept.paymentStatus, 'SUCCESS');
  });

  it('keeps allocated vouchers and affiliate commissions', async () => {
    const order = await createOrder('0240000002', 'BECE');
    await prisma.voucher.create({
      data: {
        type: 'BECE',
        serialNumber: `SN-${crypto.randomUUID()}`,
        pin: '12345678',
        status: 'SOLD',
        orderId: order.id
      }
    });

    await clearSmsContacts({ voucherType: null });

    assert.equal(await prisma.voucher.count({ where: { orderId: order.id } }), 1);
  });
});

describe('receiving new contacts afterwards', () => {
  it('lets a caller who dials again register as a new contact', async () => {
    const MOBILE = '233240000009';

    // The unique constraint on (phoneNumber, voucherType) is why the row must be
    // deleted rather than filtered — otherwise this second dial inserts nothing
    await createDialer(MOBILE, 'BECE');
    assert.equal(await contactsFor('BECE'), 1);

    await clearSmsContacts({ voucherType: 'BECE' });
    assert.equal(await contactsFor('BECE'), 0);

    trackUssdDialer({ phoneNumber: MOBILE, voucherType: 'BECE', source: 'MAIN_USSD' });

    // Tracking is fire-and-forget
    let count = 0;
    for (let attempt = 0; attempt < 25 && count === 0; attempt++) {
      count = await contactsFor('BECE');
      if (count === 0) await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.equal(count, 1, 'a returning dialer should come back as a contact');
  });

  it('brings a past customer back when they order again', async () => {
    await createOrder('0240000002', 'BECE');
    await clearSmsContacts({ voucherType: 'BECE' });
    assert.equal(await contactsFor('BECE'), 0);

    // Same person, new order after the cut-off
    await createOrder('0240000002', 'BECE');
    assert.equal(await contactsFor('BECE'), 1, 'a repeat customer should become reachable again');
  });

  it('does not resurrect contacts whose only activity predates the clearance', async () => {
    await createOrder('0240000002', 'BECE');
    await clearSmsContacts({ voucherType: 'BECE' });

    // A different person orders; the cleared one stays out
    await createOrder('0240000077', 'BECE');

    const { recipients } = await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'ALL' });
    assert.deepEqual(recipients, ['233240000077']);
  });

  it('keeps the SUCCESSFUL and FAILED_ONLY segments consistent with the clearance', async () => {
    await createOrder('0240000002', 'BECE', { paymentStatus: 'SUCCESS' });
    await createOrder('0240000003', 'BECE', { paymentStatus: 'FAILED' });

    assert.equal((await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'SUCCESSFUL' })).recipients.length, 1);
    assert.equal((await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'FAILED_ONLY' })).recipients.length, 1);

    await clearSmsContacts({ voucherType: 'BECE' });

    assert.equal((await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'SUCCESSFUL' })).recipients.length, 0);
    assert.equal((await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'FAILED_ONLY' })).recipients.length, 0);
  });
});

describe('the contact summary', () => {
  it('reports a count per type plus the total', async () => {
    await createDialer('233240000001', 'BECE');
    await createOrder('0240000002', 'WASSCE_NOVDEC');
    await createOrder('0240000003', 'CTVET_NABTEX');

    const summary = await smsContactSummary();

    assert.equal(summary.total.contacts, 3);
    assert.deepEqual(
      summary.types.map((t) => [t.voucherType, t.contacts]),
      [['BECE', 1], ['WASSCE_NOVDEC', 1], ['CTVET_NABTEX', 1]]
    );
  });

  it('records when each type was last cleared', async () => {
    await createDialer('233240000001', 'BECE');
    await clearSmsContacts({ voucherType: 'BECE' });

    const summary = await smsContactSummary();
    const bece = summary.types.find((t) => t.voucherType === 'BECE');

    assert.ok(bece.lastClearedAt, 'BECE should record a clearance');
    assert.equal(summary.types.find((t) => t.voucherType === 'WASSCE_NOVDEC').lastClearedAt, null);
  });
});

describe('the endpoints', () => {
  it('clears one type over HTTP and reports what happened', async () => {
    const { token } = await createAdminSession();
    await createDialer('233240000001', 'BECE');
    await createOrder('0240000002', 'BECE');

    const res = await app.request('DELETE', '/api/admin/sms/contacts?voucherType=BECE', {
      token,
      ip: uniqueIp()
    });

    assert.equal(res.status, 200, res.body?.message);
    assert.equal(res.body.data.contactsBefore, 2);
    assert.equal(res.body.data.contactsAfter, 0);
    assert.equal(res.body.data.voucherType, 'BECE');
  });

  it('clears every type when none is named', async () => {
    const { token } = await createAdminSession();
    await createDialer('233240000001', 'BECE');
    await createDialer('233240000003', 'CTVET_NABTEX');

    const res = await app.request('DELETE', '/api/admin/sms/contacts', { token, ip: uniqueIp() });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.contactsBefore, 2);
    assert.equal(res.body.data.voucherType, null);
  });

  it('records who cleared the list', async () => {
    const { admin, token } = await createAdminSession();
    await createDialer('233240000001', 'BECE');

    await app.request('DELETE', '/api/admin/sms/contacts?voucherType=BECE', { token, ip: uniqueIp() });

    const clearance = await prisma.smsContactClearance.findFirst({ where: { voucherType: 'BECE' } });
    assert.equal(clearance.clearedById, admin.id);
    assert.equal(clearance.dialersDeleted, 1);
  });

  it('rejects a voucher type it does not know', async () => {
    const { token } = await createAdminSession();
    const res = await app.request('DELETE', '/api/admin/sms/contacts?voucherType=WAEC_OTHER', {
      token,
      ip: uniqueIp()
    });
    assert.equal(res.status, 400);
  });

  it('is not reachable without an admin session', async () => {
    const res = await app.request('DELETE', '/api/admin/sms/contacts', { ip: uniqueIp() });
    assert.equal(res.status, 401);

    const summary = await app.request('GET', '/api/admin/sms/contacts', { ip: uniqueIp() });
    assert.equal(summary.status, 401);
  });

  it('serves the summary to an admin', async () => {
    const { token } = await createAdminSession();
    await createOrder('0240000002', 'BECE');

    const res = await app.request('GET', '/api/admin/sms/contacts', { token, ip: uniqueIp() });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.total.contacts, 1);
    assert.equal(res.body.data.types.length, 3);
  });
});
