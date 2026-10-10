/**
 * Security regression tests for two-factor sign-in.
 *
 *   TEST_DATABASE_URL="mysql://root:testpass@127.0.0.1:33306/civictree_test" npm run test:security
 */
import { hubtel, prisma, startApp, resetDatabase, uniqueIp } from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';

const { default: authRouter } = await import('../../routes/auth/authRoutes.js');
const { default: adminAffiliateRouter } = await import('../../routes/admin/affiliateRoutes.js');
const { default: userRouter } = await import('../../routes/admin/userRoutes.js');
const { decryptSecret } = await import('../../utils/crypto/secretBox.js');

let app;
const PASSWORD = 'Correct-Horse-42';

// Each code can be used only once, and enrolment uses up the current one,
// so later steps in a test need the code from the next 30-second window.
// clone() leaves the shared authenticator (and the app's settings on it) untouched
const codeForNextWindow = (secret) => authenticator.clone({ epoch: Date.now() + 30_000 }).generate(secret);

const createAdmin = async () => {
  const admin = await prisma.user.create({
    data: {
      fullName: 'Admin User',
      email: `admin-${crypto.randomUUID()}@example.com`,
      phoneNumber: `024${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
      role: 'ADMIN',
      password: await bcrypt.hash(PASSWORD, 4),
      firstTimeLogin: false
    }
  });
  const login = await app.request('POST', '/api/auth/login', { body: { email: admin.email, password: PASSWORD }, ip: uniqueIp() });
  return { admin, token: login.body.data.accessToken };
};

/** Runs the full enrolment: setup, scan, confirm. Returns the secret and recovery codes. */
const enrolTwoFactor = async (token) => {
  const setup = await app.request('POST', '/api/auth/two-factor/setup', { token, body: { currentPassword: PASSWORD } });
  assert.equal(setup.status, 200);
  const secret = setup.body.data.manualEntryKey;

  const enable = await app.request('POST', '/api/auth/two-factor/enable', {
    token,
    body: { code: authenticator.generate(secret) },
    ip: uniqueIp()
  });
  assert.equal(enable.status, 200);
  return { secret, recoveryCodes: enable.body.data.recoveryCodes };
};

const loginWithPassword = (email, ip = uniqueIp()) =>
  app.request('POST', '/api/auth/login', { body: { email, password: PASSWORD }, ip });

before(async () => {
  app = await startApp([
    ['/api/auth', authRouter],
    ['/api/admin/affiliates', adminAffiliateRouter],
    ['/api/users', userRouter]
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

describe('two-factor enrolment', () => {
  it('needs the account password to start', async () => {
    const { token } = await createAdmin();

    const res = await app.request('POST', '/api/auth/two-factor/setup', { token, body: { currentPassword: 'wrong-password' } });

    assert.equal(res.status, 401);
    assert.equal(await prisma.user.count({ where: { twoFactorSecret: { not: null } } }), 0);
  });

  it('stores the secret encrypted and only switches on after a valid code', async () => {
    const { admin, token } = await createAdmin();

    const setup = await app.request('POST', '/api/auth/two-factor/setup', { token, body: { currentPassword: PASSWORD } });
    assert.match(setup.body.data.qrCodeDataUrl, /^data:image\/png;base64,/);
    const secret = setup.body.data.manualEntryKey;

    // Not on yet, and the stored secret is not the plain value
    const pending = await prisma.user.findUnique({ where: { id: admin.id } });
    assert.equal(pending.twoFactorEnabled, false);
    assert.notEqual(pending.twoFactorSecret, secret);
    assert.equal(decryptSecret(pending.twoFactorSecret), secret);

    const wrongCode = await app.request('POST', '/api/auth/two-factor/enable', { token, body: { code: '000000' }, ip: uniqueIp() });
    assert.equal(wrongCode.status, 400);
    assert.equal((await prisma.user.findUnique({ where: { id: admin.id } })).twoFactorEnabled, false);

    const enable = await app.request('POST', '/api/auth/two-factor/enable', {
      token,
      body: { code: authenticator.generate(secret) },
      ip: uniqueIp()
    });
    assert.equal(enable.status, 200);
    assert.equal(enable.body.data.recoveryCodes.length, 10);
    assert.equal((await prisma.user.findUnique({ where: { id: admin.id } })).twoFactorEnabled, true);
  });

  it('stores recovery codes only as hashes', async () => {
    const { admin, token } = await createAdmin();
    const { recoveryCodes } = await enrolTwoFactor(token);

    const stored = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: admin.id } });
    assert.equal(stored.length, 10);
    for (const row of stored) {
      assert.match(row.codeHash, /^[0-9a-f]{64}$/);
      assert.ok(!recoveryCodes.includes(row.codeHash));
    }
  });
});

describe('signing in with two-factor', () => {
  it('gives no session until the code is checked', async () => {
    const { admin, token } = await createAdmin();
    const { secret } = await enrolTwoFactor(token);

    const passwordStep = await loginWithPassword(admin.email);
    assert.equal(passwordStep.status, 200);
    assert.equal(passwordStep.body.data.twoFactorRequired, true);
    assert.equal(passwordStep.body.data.accessToken, undefined);
    assert.ok(passwordStep.body.data.challengeToken);

    // The challenge token is not a session token
    const rejected = await app.request('GET', '/api/users', { token: passwordStep.body.data.challengeToken });
    assert.equal(rejected.status, 401);

    const codeStep = await app.request('POST', '/api/auth/login/two-factor', {
      body: { challengeToken: passwordStep.body.data.challengeToken, code: codeForNextWindow(secret) },
      ip: uniqueIp()
    });
    assert.equal(codeStep.status, 200);
    assert.ok(codeStep.body.data.accessToken);

    const allowed = await app.request('GET', '/api/users', { token: codeStep.body.data.accessToken });
    assert.equal(allowed.status, 200);
  });

  it('rejects a wrong code and counts it towards the lockout', async () => {
    const { admin, token } = await createAdmin();
    await enrolTwoFactor(token);
    const { challengeToken } = (await loginWithPassword(admin.email)).body.data;

    const res = await app.request('POST', '/api/auth/login/two-factor', {
      body: { challengeToken, code: '000000' },
      ip: uniqueIp()
    });

    assert.equal(res.status, 401);
    assert.equal((await prisma.user.findUnique({ where: { id: admin.id } })).failedLoginAttempts, 1);
  });

  it('does not accept the same code twice', async () => {
    const { admin, token } = await createAdmin();
    const { secret } = await enrolTwoFactor(token);
    const code = codeForNextWindow(secret);

    const first = await app.request('POST', '/api/auth/login/two-factor', {
      body: { challengeToken: (await loginWithPassword(admin.email)).body.data.challengeToken, code },
      ip: uniqueIp()
    });
    assert.equal(first.status, 200);

    const replay = await app.request('POST', '/api/auth/login/two-factor', {
      body: { challengeToken: (await loginWithPassword(admin.email)).body.data.challengeToken, code },
      ip: uniqueIp()
    });
    assert.equal(replay.status, 401);
  });

  it('accepts a recovery code once and warns the owner', async () => {
    const { admin, token } = await createAdmin();
    const { recoveryCodes } = await enrolTwoFactor(token);
    const recoveryCode = recoveryCodes[0];

    const first = await app.request('POST', '/api/auth/login/two-factor', {
      body: { challengeToken: (await loginWithPassword(admin.email)).body.data.challengeToken, code: recoveryCode },
      ip: uniqueIp()
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.usedRecoveryCode, true);
    assert.ok(hubtel.sms.some((sms) => /recovery code was used/i.test(sms.Content)));

    const reuse = await app.request('POST', '/api/auth/login/two-factor', {
      body: { challengeToken: (await loginWithPassword(admin.email)).body.data.challengeToken, code: recoveryCode },
      ip: uniqueIp()
    });
    assert.equal(reuse.status, 401);
  });

  it('refuses a challenge token that was tampered with', async () => {
    const { admin, token } = await createAdmin();
    const { secret } = await enrolTwoFactor(token);
    const { challengeToken } = (await loginWithPassword(admin.email)).body.data;

    const [header, payload, signature] = challengeToken.split('.');
    const forged = `${header}.${Buffer.from(JSON.stringify({ id: admin.id, typ: 'access' })).toString('base64url')}.${signature}`;

    const res = await app.request('POST', '/api/auth/login/two-factor', {
      body: { challengeToken: forged, code: authenticator.generate(secret) },
      ip: uniqueIp()
    });
    assert.equal(res.status, 401);
  });
});

describe('turning two-factor off', () => {
  it('needs both the password and a current code', async () => {
    const { admin, token } = await createAdmin();
    const { secret } = await enrolTwoFactor(token);

    const noCode = await app.request('POST', '/api/auth/two-factor/disable', {
      token, body: { currentPassword: PASSWORD, code: '000000' }, ip: uniqueIp()
    });
    assert.equal(noCode.status, 400);

    const wrongPassword = await app.request('POST', '/api/auth/two-factor/disable', {
      token, body: { currentPassword: 'nope', code: codeForNextWindow(secret) }, ip: uniqueIp()
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal((await prisma.user.findUnique({ where: { id: admin.id } })).twoFactorEnabled, true);

    const ok = await app.request('POST', '/api/auth/two-factor/disable', {
      token, body: { currentPassword: PASSWORD, code: codeForNextWindow(secret) }, ip: uniqueIp()
    });
    assert.equal(ok.status, 200);

    const user = await prisma.user.findUnique({ where: { id: admin.id } });
    assert.equal(user.twoFactorEnabled, false);
    assert.equal(user.twoFactorSecret, null);
    assert.equal(await prisma.twoFactorRecoveryCode.count({ where: { userId: admin.id } }), 0);
  });
});

describe('payouts with two-factor', () => {
  const payoutBody = (overrides = {}) => ({
    amount: 100,
    payoutMethod: 'MOBILE_MONEY',
    momoNetwork: 'MTN',
    momoNumber: '0241234567',
    momoAccountName: 'Admin Person',
    currentPassword: PASSWORD,
    ...overrides
  });

  it('need a code once two-factor is on', async () => {
    const { token } = await createAdmin();
    const { secret } = await enrolTwoFactor(token);

    const withoutCode = await app.request('POST', '/api/admin/affiliates/withdrawals/direct', { token, body: payoutBody() });
    assert.equal(withoutCode.status, 401);
    assert.equal(hubtel.payouts.length, 0);

    const wrongCode = await app.request('POST', '/api/admin/affiliates/withdrawals/direct', { token, body: payoutBody({ twoFactorCode: '000000' }) });
    assert.equal(wrongCode.status, 401);
    assert.equal(hubtel.payouts.length, 0);

    const withCode = await app.request('POST', '/api/admin/affiliates/withdrawals/direct', {
      token,
      body: payoutBody({ twoFactorCode: codeForNextWindow(secret) })
    });
    assert.equal(withCode.status, 200);
    assert.equal(hubtel.payouts.length, 1);
  });
});

describe('approving affiliate withdrawals with two-factor', () => {
  const createPendingWithdrawal = async () => {
    const user = await prisma.user.create({
      data: {
        fullName: 'Affiliate User',
        email: `aff-${crypto.randomUUID()}@example.com`,
        role: 'AFFILIATE',
        password: await bcrypt.hash(PASSWORD, 4)
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
    return prisma.withdrawalRequest.create({
      data: {
        affiliateId: profile.id,
        amount: 50,
        payoutMethod: 'MOBILE_MONEY',
        accountDetails: JSON.stringify({ method: 'MOBILE_MONEY', network: 'MTN', number: '0241234567', accountName: 'Affiliate User' }),
        status: 'PENDING'
      }
    });
  };

  const statusOf = async (id) => (await prisma.withdrawalRequest.findUnique({ where: { id } })).status;

  it('refuses to approve without a code, and leaves the request in the queue', async () => {
    const { token } = await createAdmin();
    await enrolTwoFactor(token);
    const withdrawal = await createPendingWithdrawal();

    const res = await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, {
      token,
      body: { status: 'APPROVED' }
    });

    assert.equal(res.status, 401);
    assert.equal(hubtel.payouts.length, 0);
    // Still claimable: it must not be stuck as PROCESSING
    assert.equal(await statusOf(withdrawal.id), 'PENDING');
  });

  it('refuses a wrong code', async () => {
    const { token } = await createAdmin();
    await enrolTwoFactor(token);
    const withdrawal = await createPendingWithdrawal();

    const res = await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, {
      token,
      body: { status: 'APPROVED', twoFactorCode: '000000' }
    });

    assert.equal(res.status, 401);
    assert.equal(hubtel.payouts.length, 0);
    assert.equal(await statusOf(withdrawal.id), 'PENDING');
  });

  it('approves and sends the payout with a valid code', async () => {
    const { token } = await createAdmin();
    const { secret } = await enrolTwoFactor(token);
    const withdrawal = await createPendingWithdrawal();

    const res = await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, {
      token,
      body: { status: 'APPROVED', twoFactorCode: codeForNextWindow(secret) }
    });

    assert.equal(res.status, 200);
    assert.equal(hubtel.payouts.length, 1);
    // Waiting for Hubtel to confirm the transfer
    assert.equal(await statusOf(withdrawal.id), 'PROCESSING');
  });

  it('does not ask for a code to reject a request', async () => {
    const { token } = await createAdmin();
    await enrolTwoFactor(token);
    const withdrawal = await createPendingWithdrawal();

    const res = await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, {
      token,
      body: { status: 'REJECTED', adminNote: 'Not eligible' }
    });

    assert.equal(res.status, 200);
    assert.equal(hubtel.payouts.length, 0);
    assert.equal(await statusOf(withdrawal.id), 'REJECTED');
  });

  it('still approves without a code when two-factor is off', async () => {
    const { token } = await createAdmin();
    const withdrawal = await createPendingWithdrawal();

    const res = await app.request('PATCH', `/api/admin/affiliates/withdrawals/${withdrawal.id}`, {
      token,
      body: { status: 'APPROVED' }
    });

    assert.equal(res.status, 200);
    assert.equal(hubtel.payouts.length, 1);
  });
});
