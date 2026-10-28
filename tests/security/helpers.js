/**
 * Shared setup for the security test suites.
 * Import this module FIRST: it prepares the environment before any app module is loaded.
 */
import crypto from 'node:crypto';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  console.error('Set TEST_DATABASE_URL to a throwaway database (its tables are wiped).');
  process.exit(1);
}
const testDbUrl = new URL(TEST_DB);
if (!['localhost', '127.0.0.1'].includes(testDbUrl.hostname) || !testDbUrl.pathname.includes('test')) {
  console.error('Refusing to run: TEST_DATABASE_URL must be a local database whose name contains "test".');
  process.exit(1);
}

// The concurrency tests open many transactions at once, so give the pool room
if (!testDbUrl.searchParams.has('connection_limit')) {
  testDbUrl.searchParams.set('connection_limit', '25');
  testDbUrl.searchParams.set('pool_timeout', '30');
}
process.env.DATABASE_URL = testDbUrl.toString();
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(48).toString('hex');
process.env.HUBTEL_PAYMENT_API_ID = 'test-api-id';
process.env.HUBTEL_PAYMENT_API_KEY = 'test-api-key';
process.env.HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER = '11684';
process.env.HUBTEL_SMS_CLIENT_ID = 'test-sms-id';
process.env.HUBTEL_SMS_CLIENT_SECRET = 'test-sms-secret';
process.env.API_URL = 'https://api.civictree.test';
process.env.HUBTEL_IP_CHECK = 'enforce';
delete process.env.HUBTEL_CALLBACK_IPS;
delete process.env.HUBTEL_CALLBACK_TOKEN;
delete process.env.ACCESS_TOKEN_TTL;
process.env.PAYMENT_VERIFY_RETRY_DELAYS_MS = '0';

export const HUBTEL_IP = '52.50.116.54';
export const OUTSIDER_IP = '203.0.113.9';

// ---- Simulated Hubtel -------------------------------------------------------
export const hubtel = {
  statuses: new Map(), // payment clientReference -> { status, amount }
  payoutStatuses: new Map(), // payout clientReference -> 'success' | 'failed' | 'pending'
  sms: [],
  ussdCallbacks: [],
  directDebits: [],
  payouts: [],
  failPayout: false, // when true, Send Money requests are rejected
  reset() {
    this.statuses.clear();
    this.payoutStatuses.clear();
    this.sms.length = 0;
    this.ussdCallbacks.length = 0;
    this.directDebits.length = 0;
    this.payouts.length = 0;
    this.failPayout = false;
  }
};

const axios = (await import('axios')).default;
axios.defaults.adapter = async (cfg) => {
  const ok = (data) => ({ data, status: 200, statusText: 'OK', headers: {}, config: cfg, request: {} });
  const body = typeof cfg.data === 'string' ? JSON.parse(cfg.data) : cfg.data;
  const url = cfg.url;

  if (url.includes('api-txnstatus.hubtel.com')) {
    const entry = hubtel.statuses.get(cfg.params?.clientReference);
    if (!entry) {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404, data: { message: 'Transaction not found' } };
      throw err;
    }
    return ok({
      responseCode: '0000',
      message: 'Successful',
      data: { status: entry.status, amount: entry.amount, transactionId: `HT-${cfg.params.clientReference}` }
    });
  }
  if (url.includes('payproxyapi.hubtel.com')) {
    return ok({
      responseCode: '0000',
      status: 'Success',
      data: { checkoutUrl: 'https://pay.hubtel.test/checkout', checkoutId: `chk-${crypto.randomUUID()}` }
    });
  }
  if (url.includes('rmp.hubtel.com')) {
    hubtel.directDebits.push(body);
    return ok({ ResponseCode: '0001', Message: 'Pending', Data: { TransactionId: 'dd-1', ClientReference: body.ClientReference } });
  }
  if (url.includes('smp.hubtel.com')) {
    // Send Money (payout)
    if (hubtel.failPayout) {
      const err = new Error('Request failed with status code 400');
      err.response = { status: 400, data: { Message: 'Insufficient prepaid balance.' } };
      throw err;
    }
    hubtel.payouts.push(body);
    return ok({ ResponseCode: '0001', Message: 'Transaction pending', Data: { TransactionId: `pay-${crypto.randomUUID()}`, ClientReference: body.ClientReference } });
  }
  if (url.includes('smrsc.hubtel.com')) {
    // Send Money status check (the reference is in the query string of the URL)
    const reference = new URL(url).searchParams.get('clientReference');
    const status = hubtel.payoutStatuses.get(reference) || 'pending';
    return ok({ ResponseCode: 'success', Data: { TransactionId: `pay-${reference}`, transactionStatus: status, Amount: 0 } });
  }
  if (url.includes('sms.hubtel.com')) {
    hubtel.sms.push(body);
    return ok({ status: 0 });
  }
  if (url.includes('gs-callback.hubtel.com')) {
    hubtel.ussdCallbacks.push(body);
    return ok({});
  }
  throw new Error(`Unexpected outbound request in test: ${url}`);
};

// ---- App modules (loaded after the environment is ready) ----------------------
export const { prisma, default: config } = await import('../../config/config.js');
const { default: express } = await import('express');
const { customError } = await import('../../utils/error/custom_error.js');

/**
 * Starts an Express app with the given routers mounted, configured like server.js.
 * @param {Array<[string, import('express').Router]>} mounts
 * @param {(app: import('express').Express) => void} [extra] - adds routes before the error handler
 */
export const startApp = async (mounts, extra) => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  for (const [path, router] of mounts) app.use(path, router);
  if (extra) extra(app);
  app.use(customError);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const request = async (method, path, { body, ip = OUTSIDER_IP, token, headers = {} } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json, headers: response.headers };
  };

  return {
    baseUrl,
    request,
    post: (path, body, ip) => request('POST', path, { body, ip }),
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

// ---- Data helpers -----------------------------------------------------------
export const BECE_PRICE = 20;
export const WASSCE_PRICE = 25;
export const CTVET_NABTEX_PRICE = 18;

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A different documentation-range IP for each call, so per-IP rate limits don't leak between tests. */
let ipCounter = 0;
export const uniqueIp = () => {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

export const resetDatabase = async () => {
  await prisma.affiliateCommission.deleteMany();
  await prisma.voucher.deleteMany();
  await prisma.order.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.ussdDialer.deleteMany();
  await prisma.affiliateProfile.deleteMany();
  await prisma.affiliateConfig.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.otp.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.user.deleteMany();
  await prisma.voucherConfig.deleteMany();
  await prisma.voucherConfig.create({
    data: { becePrice: BECE_PRICE, wassceNovdecPrice: WASSCE_PRICE, ctvetNabtexPrice: CTVET_NABTEX_PRICE }
  });
};

/**
 * Activity logging is fire-and-forget, so wait for the expected action to land
 * rather than guessing a fixed delay (which is flaky when the suite is under load).
 *
 * @param {string} [expectedAction] - Action to wait for
 * @param {number} [timeoutMs]
 */
export const activityActions = async (expectedAction, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  let actions = [];

  for (;;) {
    actions = (await prisma.activityLog.findMany()).map((log) => log.action);
    if (!expectedAction || actions.includes(expectedAction) || Date.now() > deadline) return actions;
    await wait(100);
  }
};
