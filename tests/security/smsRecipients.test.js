/**
 * Regression tests for bulk SMS recipient selection.
 *
 * Two bugs these lock down:
 *
 *  1. USSD stores Hubtel's Mobile as 233XXXXXXXXX while web checkout stores
 *     0XXXXXXXXX. Deduplicating the raw strings counted one person twice, so
 *     they received the campaign twice and the business paid twice.
 *
 *  2. The admin screen guessed the recipient count client-side from voucher
 *     sales multiplied by invented ratios, with hardcoded fallbacks. The count
 *     shown — and the credit cost derived from it — had no relationship to the
 *     list that would actually be sent. The count endpoint now runs the same
 *     builder the send path runs.
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
const { buildSmsRecipients, toCanonicalPhone } = await import('../../utils/sms/smsRecipients.js');

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

const createOrder = (phoneNumber, overrides = {}) => prisma.order.create({
  data: {
    id: `ORD-${crypto.randomUUID()}`,
    phoneNumber,
    voucherType: 'BECE',
    quantity: 1,
    amount: 20,
    channel: 'WEB',
    paymentStatus: 'SUCCESS',
    ...overrides
  }
});

const createDialer = (phoneNumber, overrides = {}) => prisma.ussdDialer.create({
  data: { phoneNumber, voucherType: 'BECE', source: 'MAIN_USSD', ...overrides }
});

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
});

describe('phone number canonicalisation', () => {
  it('reduces every stored format to the one Hubtel sends to', () => {
    for (const input of ['0241234567', '233241234567', '+233241234567', '024 123 4567', '024-123-4567', '241234567']) {
      assert.equal(toCanonicalPhone(input), '233241234567', `failed for ${input}`);
    }
  });

  it('rejects anything that is not a Ghana mobile number', () => {
    // 1 is not a valid prefix, and the rest are not numbers at all
    for (const input of ['0141234567', '12345', '', null, undefined, 'not a phone', '23324123456789']) {
      assert.equal(toCanonicalPhone(input), null, `should have rejected ${input}`);
    }
  });
});

describe('recipient selection', () => {
  it('counts someone reachable from both USSD and an order only once', async () => {
    // The same person: dialled USSD, then bought on the web
    await createDialer('233249990001');
    await createOrder('0249990001');

    const { recipients, sourceRows, duplicatesMerged } = await buildSmsRecipients({
      voucherType: 'BECE',
      recipientType: 'ALL'
    });

    assert.equal(sourceRows, 2, 'two rows should have been read');
    assert.deepEqual(recipients, ['233249990001']);
    assert.equal(duplicatesMerged, 1);
  });

  it('keeps genuinely different people apart', async () => {
    await createDialer('233249990001');
    await createOrder('0249990002');
    await createOrder('0249990003');

    const { recipients } = await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'ALL' });
    assert.equal(recipients.length, 3);
    assert.deepEqual([...recipients].sort(), ['233249990001', '233249990002', '233249990003']);
  });

  it('drops unusable numbers instead of sending to them', async () => {
    await createOrder('0249990001');
    await createDialer('not-a-number');
    await createDialer('12345');

    const { recipients, unusable } = await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'ALL' });
    assert.deepEqual(recipients, ['233249990001']);
    assert.equal(unusable, 2);
  });

  it('does not treat a paying customer as failed because of the number format', async () => {
    // Paid under the local format, abandoned an attempt under the international one
    await createOrder('0249990001', { paymentStatus: 'SUCCESS' });
    await createOrder('233249990001', { paymentStatus: 'PENDING' });

    const failed = await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'FAILED_ONLY' });
    assert.deepEqual(failed.recipients, [], 'a paying customer must not be in FAILED_ONLY');

    const paid = await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'SUCCESSFUL' });
    assert.deepEqual(paid.recipients, ['233249990001']);
  });

  it('includes someone who only ever failed', async () => {
    await createOrder('0249990009', { paymentStatus: 'FAILED' });

    const failed = await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'FAILED_ONLY' });
    assert.deepEqual(failed.recipients, ['233249990009']);
  });

  it('separates the two voucher types, and reaches both when unscoped', async () => {
    await createOrder('0249990001', { voucherType: 'BECE' });
    await createOrder('0249990002', { voucherType: 'WASSCE_NOVDEC' });

    const bece = await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'ALL' });
    assert.deepEqual(bece.recipients, ['233249990001']);

    const wassce = await buildSmsRecipients({ voucherType: 'WASSCE_NOVDEC', recipientType: 'ALL' });
    assert.deepEqual(wassce.recipients, ['233249990002']);

    // No voucherType means every product
    const everyone = await buildSmsRecipients({ recipientType: 'ALL' });
    assert.equal(everyone.recipients.length, 2);
  });

  it('refuses a segment it does not know', async () => {
    await assert.rejects(
      () => buildSmsRecipients({ recipientType: 'EVERYBODY' }),
      /Invalid recipientType/
    );
  });
});

describe('the recipient count endpoint', () => {
  it('reports the same number the send path would use', async () => {
    const { token } = await createAdminSession();
    await createDialer('233249990001');
    await createOrder('0249990001');   // same person
    await createOrder('0249990002');

    const res = await app.request('GET', '/api/admin/sms/recipients/count?recipientType=ALL&voucherType=BECE', {
      token,
      ip: uniqueIp()
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.totalRecipients, 2, 'three rows, two people');
    assert.equal(res.body.data.duplicatesMerged, 1);

    const built = await buildSmsRecipients({ voucherType: 'BECE', recipientType: 'ALL' });
    assert.equal(res.body.data.totalRecipients, built.recipients.length);
  });

  it('counts across both products when no voucher type is given', async () => {
    const { token } = await createAdminSession();
    await createOrder('0249990001', { voucherType: 'BECE' });
    await createOrder('0249990002', { voucherType: 'WASSCE_NOVDEC' });

    const res = await app.request('GET', '/api/admin/sms/recipients/count?recipientType=ALL', {
      token,
      ip: uniqueIp()
    });
    assert.equal(res.body.data.totalRecipients, 2);
  });

  it('returns zero rather than guessing when nobody matches', async () => {
    const { token } = await createAdminSession();

    const res = await app.request('GET', '/api/admin/sms/recipients/count?recipientType=SUCCESSFUL&voucherType=BECE', {
      token,
      ip: uniqueIp()
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.totalRecipients, 0);
  });

  it('rejects an unknown segment', async () => {
    const { token } = await createAdminSession();
    const res = await app.request('GET', '/api/admin/sms/recipients/count?recipientType=EVERYBODY', {
      token,
      ip: uniqueIp()
    });
    assert.equal(res.status, 400);
  });

  it('accepts the legacy product division options the admin screen offers', async () => {
    const { token } = await createAdminSession();
    await createOrder('0249990001', { voucherType: 'BECE' });

    // "BECE" names a product, not a payment status. The general endpoint used to
    // hand it straight to the per-product handler, which rejected it as invalid.
    const res = await app.request('POST', '/api/admin/sms/bulk', {
      token,
      ip: uniqueIp(),
      body: { recipientType: 'BECE', title: 'Legacy', body: 'Results are out.' }
    });

    assert.equal(res.status, 200, res.body?.message);
    assert.equal(res.body.data.totalRecipients, 1);
  });

  it('is not reachable without an admin session', async () => {
    const res = await app.request('GET', '/api/admin/sms/recipients/count?recipientType=ALL', { ip: uniqueIp() });
    assert.equal(res.status, 401);
  });
});
