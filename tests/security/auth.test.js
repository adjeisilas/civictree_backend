/**
 * Security regression tests for login, sessions, password reset, validation and error handling.
 *
 *   TEST_DATABASE_URL="mysql://root:testpass@127.0.0.1:33306/civictree_test" npm run test:security
 */
import { hubtel, prisma, startApp, resetDatabase, uniqueIp, wait } from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const { default: authRouter } = await import('../../routes/auth/authRoutes.js');
const { default: partnerAuthRouter } = await import('../../routes/auth/partnerAuthRoutes.js');
const { default: userRouter } = await import('../../routes/admin/userRoutes.js');
const { MAX_OTP_ATTEMPTS } = await import('../../utils/auth/otp.js');
const { MAX_FAILED_LOGINS } = await import('../../utils/auth/loginGuard.js');

let app;

const PASSWORD = 'Correct-Horse-42';

const createUser = async ({ role = 'ADMIN', email, phoneNumber = null, password = PASSWORD } = {}) =>
  prisma.user.create({
    data: {
      fullName: 'Test User',
      email: email || `user-${crypto.randomUUID()}@example.com`,
      phoneNumber,
      role,
      password: await bcrypt.hash(password, 4),
      firstTimeLogin: false
    }
  });

const login = (email, password, ip = uniqueIp()) =>
  app.request('POST', '/api/auth/login', { body: { email, password }, ip });

// The reset code is only ever delivered by SMS; read it from the simulated Hubtel inbox
const lastCodeSentTo = async (phoneInternational) => {
  await wait(100); // delivery is fire-and-forget
  const message = [...hubtel.sms].reverse().find((sms) => sms.To === phoneInternational);
  return message?.Content.match(/\b(\d{6})\b/)?.[1];
};

before(async () => {
  app = await startApp(
    [
      ['/api/auth', authRouter],
      ['/api/auth/partner', partnerAuthRouter],
      ['/api/users', userRouter]
    ],
    (expressApp) => {
      expressApp.get('/boom', () => {
        throw new Error('Connection to mysql://root:hunter2@db failed');
      });
    }
  );
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  hubtel.reset();
  await resetDatabase();
});

describe('login', () => {
  it('issues access tokens that expire after 15 minutes', async () => {
    const user = await createUser();
    const res = await login(user.email, PASSWORD);

    assert.equal(res.status, 200);
    const decoded = jwt.decode(res.body.data.accessToken);
    assert.equal(decoded.exp - decoded.iat, 15 * 60);
  });

  it('locks the account after repeated wrong passwords, even from many IPs', async () => {
    const user = await createUser();

    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      assert.equal((await login(user.email, 'wrong-password')).status, 401);
    }

    const res = await login(user.email, PASSWORD);
    assert.equal(res.status, 429);
    assert.ok((await prisma.user.findUnique({ where: { id: user.id } })).lockedUntil > new Date());
  });

  it('resets the failed-login counter after a successful login', async () => {
    const user = await createUser();
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) await login(user.email, 'wrong-password');

    assert.equal((await login(user.email, PASSWORD)).status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).failedLoginAttempts, 0);
  });

  it('rate-limits repeated failures from one network for one account', async () => {
    const user = await createUser();
    const ip = uniqueIp();

    for (let i = 0; i < 5; i++) await login(user.email, 'wrong-password', ip);
    const res = await login(user.email, PASSWORD, ip);

    assert.equal(res.status, 429);
  });

  it('does not reveal that an account is deactivated without the right password', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    assert.equal((await login(user.email, 'wrong-password')).status, 401);
    assert.equal((await login(user.email, PASSWORD)).status, 403);
  });

  it('rejects malformed input with a clear message', async () => {
    const res = await login('not-an-email', 'x');
    assert.equal(res.status, 400);
    assert.match(res.body.message, /email/i);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and refuses to reuse an old one', async () => {
    const user = await createUser();
    const { refreshToken } = (await login(user.email, PASSWORD)).body.data;

    const first = await app.request('POST', '/api/auth/refresh', { body: { refreshToken } });
    assert.equal(first.status, 200);
    assert.ok(first.body.data.accessToken);

    const reuse = await app.request('POST', '/api/auth/refresh', { body: { refreshToken } });
    assert.equal(reuse.status, 401);
  });

  it('stops a partner login from acting as an admin with the same email', async () => {
    const sharedEmail = `shared-${crypto.randomUUID()}@example.com`;
    const admin = await createUser({ role: 'ADMIN', email: sharedEmail, password: 'Admin-Only-Password-1' });
    await prisma.partner.create({
      data: {
        partnerId: 'PRT-TEST',
        partnerName: 'Test Partner',
        email: sharedEmail,
        phone: '0200000001',
        passwordHash: await bcrypt.hash('Partner-Password-1', 4),
        contractRef: 'CTR-TEST',
        status: 'Active'
      }
    });

    const res = await app.request('POST', '/api/auth/partner/login', {
      body: { email: sharedEmail, password: 'Partner-Password-1' },
      ip: uniqueIp()
    });
    assert.equal(res.status, 200);
    assert.notEqual(jwt.decode(res.body.data.accessToken).id, admin.id);

    const adminOnly = await app.request('GET', '/api/users', { token: res.body.data.accessToken });
    assert.notEqual(adminOnly.status, 200);
  });
});

describe('password reset', () => {
  it('gives the same answer for unknown and known accounts', async () => {
    const user = await createUser({ phoneNumber: '0241234567' });

    const unknown = await app.request('POST', '/api/auth/forgot-password', { body: { email: 'nobody@example.com' }, ip: uniqueIp() });
    const known = await app.request('POST', '/api/auth/forgot-password', { body: { email: user.email }, ip: uniqueIp() });

    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.equal(unknown.body.message, known.body.message);
  });

  it('stores only a hash of the code and sends the code by SMS', async () => {
    const user = await createUser({ phoneNumber: '0241234567' });
    await app.request('POST', '/api/auth/forgot-password', { body: { email: user.email }, ip: uniqueIp() });

    const code = await lastCodeSentTo('233241234567');
    assert.match(code, /^\d{6}$/);
    const stored = await prisma.otp.findFirst({ where: { userId: user.id } });
    assert.notEqual(stored.code, code);
    assert.match(stored.code, /^[0-9a-f]{64}$/);
  });

  it('completes a genuine reset and signs out other sessions', async () => {
    const user = await createUser({ phoneNumber: '0241234567' });
    const oldSession = (await login(user.email, PASSWORD)).body.data;

    await app.request('POST', '/api/auth/forgot-password', { body: { email: user.email }, ip: uniqueIp() });
    const otp = await lastCodeSentTo('233241234567');
    const ip = uniqueIp();

    const check = await app.request('POST', '/api/auth/validate-otp', { body: { email: user.email, otp }, ip });
    assert.equal(check.status, 200);

    const newPassword = 'Brand-New-Password-9';
    const reset = await app.request('POST', '/api/auth/reset-password', {
      body: { email: user.email, otp, newPassword, confirmPassword: newPassword },
      ip
    });
    assert.equal(reset.status, 200);

    assert.equal((await login(user.email, PASSWORD)).status, 401);
    assert.equal((await login(user.email, newPassword)).status, 200);

    const reusedSession = await app.request('POST', '/api/auth/refresh', { body: { refreshToken: oldSession.refreshToken } });
    assert.equal(reusedSession.status, 401);

    const reusedCode = await app.request('POST', '/api/auth/reset-password', {
      body: { email: user.email, otp, newPassword: 'Another-Password-7', confirmPassword: 'Another-Password-7' },
      ip: uniqueIp()
    });
    assert.equal(reusedCode.status, 400);

    await wait(100);
    assert.ok(hubtel.sms.some((sms) => /password was just reset/.test(sms.Content)));
  });

  it(`withdraws a code after ${MAX_OTP_ATTEMPTS} wrong guesses`, async () => {
    const user = await createUser({ phoneNumber: '0241234567' });
    await app.request('POST', '/api/auth/forgot-password', { body: { email: user.email }, ip: uniqueIp() });
    const otp = await lastCodeSentTo('233241234567');
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
      const res = await app.request('POST', '/api/auth/validate-otp', { body: { email: user.email, otp: wrong }, ip: uniqueIp() });
      assert.equal(res.status, 400);
    }

    const correct = await app.request('POST', '/api/auth/validate-otp', { body: { email: user.email, otp }, ip: uniqueIp() });
    assert.equal(correct.status, 400);
  });

  it('cannot be brute-forced with simultaneous guesses', async () => {
    const user = await createUser({ phoneNumber: '0241234567' });
    await app.request('POST', '/api/auth/forgot-password', { body: { email: user.email }, ip: uniqueIp() });
    const otp = await lastCodeSentTo('233241234567');

    const guesses = Array.from({ length: 40 }, (_, i) => String(i).padStart(6, '0')).filter((guess) => guess !== otp);
    await Promise.all(guesses.map((guess) =>
      app.request('POST', '/api/auth/validate-otp', { body: { email: user.email, otp: guess }, ip: uniqueIp() })
    ));

    const stored = await prisma.otp.findFirst({ where: { userId: user.id } });
    assert.ok(stored.attempts <= MAX_OTP_ATTEMPTS, `attempts recorded: ${stored.attempts}`);

    const correct = await app.request('POST', '/api/auth/validate-otp', { body: { email: user.email, otp }, ip: uniqueIp() });
    assert.equal(correct.status, 400);
  });

  it('does not accept codes stored in plain text by the old system', async () => {
    const user = await createUser();
    await prisma.otp.create({
      data: { userId: user.id, code: '123456', expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
    });

    const res = await app.request('POST', '/api/auth/validate-otp', { body: { email: user.email, otp: '123456' }, ip: uniqueIp() });
    assert.equal(res.status, 400);
  });

  it('enforces the password policy on the new password', async () => {
    const res = await app.request('POST', '/api/auth/reset-password', {
      body: { email: 'someone@example.com', otp: '123456', newPassword: 'short', confirmPassword: 'short' },
      ip: uniqueIp()
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /at least 10 characters/);
  });
});

describe('admin user management', () => {
  it('cannot create or promote accounts to affiliate or partner roles', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const token = (await login(admin.email, PASSWORD)).body.data.accessToken;

    const created = await app.request('POST', '/api/users', {
      token,
      body: { fullName: 'New Person', email: 'new@example.com', password: 'Long-Enough-Pass-1', role: 'PARTNER', phoneNumber: '' }
    });
    assert.equal(created.status, 400);

    const user = await createUser({ role: 'USER' });
    const promoted = await app.request('PATCH', `/api/users/${user.id}`, { token, body: { role: 'AFFILIATE' } });
    assert.equal(promoted.status, 400);

    const ok = await app.request('POST', '/api/users', {
      token,
      body: { fullName: 'New Person', email: 'new@example.com', password: 'Long-Enough-Pass-1', role: 'USER', phoneNumber: '' }
    });
    assert.equal(ok.status, 201);
  });
});

describe('error responses', () => {
  it('hide internal error details outside development', async () => {
    const res = await app.request('GET', '/boom');

    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /hunter2|mysql/);
    assert.ok(res.body.errorId);
    assert.equal(res.body.stack, undefined);
  });
});
