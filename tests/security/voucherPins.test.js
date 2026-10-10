/**
 * Security regression tests for voucher PINs: encrypted at rest, masked in admin lists,
 * revealed only on request (and recorded), yet still delivered correctly to customers.
 *
 *   TEST_DATABASE_URL="mysql://root:testpass@127.0.0.1:33306/civictree_test" npm run test:security
 */
import { hubtel, prisma, startApp, resetDatabase, uniqueIp, activityActions, HUBTEL_IP, BECE_PRICE } from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const { default: authRouter } = await import('../../routes/auth/authRoutes.js');
const { default: adminVoucherRouter } = await import('../../routes/admin/voucherRoutes.js');
const { default: orderRouter } = await import('../../routes/public/orderRoutes.js');
const { encryptPin, readPin, maskPin } = await import('../../utils/voucher/voucherPin.js');
const { isEncrypted } = await import('../../utils/crypto/secretBox.js');
const { readSpreadsheetRows } = await import('../../utils/file/spreadsheet.js');

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
  const login = await app.request('POST', '/api/auth/login', { body: { email: admin.email, password: PASSWORD }, ip: uniqueIp() });
  return { admin, token: login.body.data.accessToken };
};

const createVoucher = (pin, overrides = {}) => prisma.voucher.create({
  data: {
    type: 'BECE',
    serialNumber: `SN-${crypto.randomUUID()}`,
    pin,
    status: 'AVAILABLE',
    ...overrides
  }
});

before(async () => {
  app = await startApp([
    ['/api/auth', authRouter],
    ['/api/vouchers', adminVoucherRouter],
    ['/api/orders', orderRouter]
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

describe('PINs at rest', () => {
  it('are unreadable without the key, and read back correctly', () => {
    const stored = encryptPin('12345678');
    assert.ok(isEncrypted(stored));
    assert.ok(!stored.includes('12345678'));
    assert.equal(readPin(stored), '12345678');
  });

  it('still work for rows saved before encryption existed', () => {
    assert.equal(readPin('87654321'), '87654321');
    assert.equal(maskPin('87654321'), '•••••321');
  });

  it('are masked with only the last few characters visible', () => {
    assert.equal(maskPin(encryptPin('12345678')), '•••••678');
  });
});

describe('admin voucher screens', () => {
  it('never return full PINs in lists', async () => {
    const { token } = await createAdminSession();
    await createVoucher(encryptPin('12345678'));

    const res = await app.request('GET', '/api/vouchers', { token });

    assert.equal(res.status, 200);
    assert.equal(res.body.data[0].pin, '•••••678');
    assert.equal(res.body.data[0].pinMasked, true);
    assert.ok(!JSON.stringify(res.body).includes('12345678'));
  });

  it('reveal one PIN on request and record who saw it', async () => {
    const { token } = await createAdminSession();
    const voucher = await createVoucher(encryptPin('12345678'));

    const res = await app.request('GET', `/api/vouchers/${voucher.id}/pin`, { token });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.pin, '12345678');
    assert.ok((await activityActions('VOUCHER_PIN_REVEALED')).includes('VOUCHER_PIN_REVEALED'));
  });

  it('do not let anyone without an admin session reveal a PIN', async () => {
    const voucher = await createVoucher(encryptPin('12345678'));

    const res = await app.request('GET', `/api/vouchers/${voucher.id}/pin`);

    assert.equal(res.status, 401);
  });
});

describe('customer delivery', () => {
  it('sends the real PIN by SMS even though it is stored encrypted', async () => {
    await createVoucher(encryptPin('55667788'));
    const order = await prisma.order.create({
      data: {
        id: `#CT-TEST-${crypto.randomBytes(4).toString('hex')}`,
        phoneNumber: '0241234567',
        voucherType: 'BECE',
        quantity: 1,
        amount: BECE_PRICE,
        channel: 'WEB',
        paymentStatus: 'PENDING',
        deliveryStatus: 'NOT_SENT'
      }
    });
    hubtel.statuses.set(order.id, { status: 'Paid', amount: BECE_PRICE });

    const res = await app.post('/api/orders/webhook', { ClientReference: order.id, ResponseCode: '0000' }, HUBTEL_IP);

    assert.equal(res.status, 200);
    assert.equal(hubtel.sms.length, 1);
    assert.ok(hubtel.sms[0].Content.includes('55667788'));
  });
});

describe('voucher file uploads', () => {
  it('reject the legacy .xls format with a clear message', async () => {
    await assert.rejects(
      () => readSpreadsheetRows({ buffer: Buffer.from(''), originalname: 'old.xls' }),
      /not supported/
    );
  });

  it('read .csv files, including quoted fields', async () => {
    const csv = Buffer.from('Serial Number,Pin Number\r\nSN-1,111\r\n"SN,2","2""2"\r\n');
    const rows = await readSpreadsheetRows({ buffer: csv, originalname: 'v.csv' });

    assert.deepEqual(rows, [['Serial Number', 'Pin Number'], ['SN-1', '111'], ['SN,2', '2"2']]);
  });
});
