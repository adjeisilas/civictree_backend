/**
 * CTVET/NABTEX behaves exactly like BECE and WASSCE/NOVDEC.
 *
 * Adding a third voucher type exposed a class of bug the two-type codebase
 * could not have: every `type === 'BECE' ? x : y` silently handed the new type
 * whatever the else branch held — the WASSCE price, the WASSCE commission, the
 * WAEC results link. These tests pin the per-type behaviour so a fourth type
 * cannot inherit a third type's values either.
 *
 *   TEST_DATABASE_URL="mysql://root:testpass@127.0.0.1:3307/civictree_test" npm run test:security
 */
import { hubtel, prisma, startApp, resetDatabase, uniqueIp, HUBTEL_IP } from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { default: ussdRouter } = await import('../../routes/public/ussdRoutes.js');
const { default: orderRouter } = await import('../../routes/public/orderRoutes.js');
const { default: publicVoucherRouter } = await import('../../routes/public/voucherRoutes.js');

const {
  VOUCHER_TYPES,
  displayNameFor,
  unitPriceFrom,
  commissionFrom,
  resultsUrlFor,
  priceFieldFor,
  commissionFieldFor
} = await import('../../utils/voucher/voucherTypes.js');
const { mainMenu, voucherTypeForKey, releaseDateMenu } = await import('../../utils/ussd/ussdMenu.js');

let app;

const createVoucher = (type) => prisma.voucher.create({
  data: {
    type,
    serialNumber: `SN-${crypto.randomUUID()}`,
    pin: '12345678',
    status: 'AVAILABLE'
  }
});

before(async () => {
  app = await startApp([
    ['/api/ussd', ussdRouter],
    ['/api/orders', orderRouter],
    ['/api/vouchers', publicVoucherRouter]
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

describe('the voucher type table', () => {
  it('includes CTVET/NABTEX alongside the original two', () => {
    assert.deepEqual(VOUCHER_TYPES, ['BECE', 'WASSCE_NOVDEC', 'CTVET_NABTEX']);
  });

  it('gives every type its own display name', () => {
    const names = VOUCHER_TYPES.map(displayNameFor);
    assert.deepEqual(names, ['BECE', 'WASSCE/NOVDEC', 'CTVET/NABTEX']);
    assert.equal(new Set(names).size, names.length, 'display names must be distinct');
  });

  it('gives every type its own config fields, with no sharing', () => {
    const priceFields = VOUCHER_TYPES.map(priceFieldFor);
    const commissionFields = VOUCHER_TYPES.map(commissionFieldFor);
    assert.equal(new Set(priceFields).size, 3, 'two types would share a price column');
    assert.equal(new Set(commissionFields).size, 3, 'two types would share a commission column');
  });

  it('refuses a type it does not know rather than guessing', () => {
    assert.throws(() => displayNameFor('WAEC_SOMETHING'), /Unknown voucher type/);
  });
});

describe('CTVET/NABTEX pricing and commission', () => {
  it('reads its own price, not another type\'s', async () => {
    const config = await prisma.voucherConfig.findFirst();

    // The fixture prices all three differently
    const prices = VOUCHER_TYPES.map((type) => unitPriceFrom(config, type));
    assert.equal(new Set(prices).size, 3, `expected three distinct prices, got ${prices}`);
    assert.equal(unitPriceFrom(config, 'CTVET_NABTEX'), Number(config.ctvetNabtexPrice));
  });

  it('pays its own commission rate', async () => {
    await prisma.affiliateConfig.create({
      data: {
        wassceNovdecCommission: 9,
        beceCommission: 5,
        ctvetNabtexCommission: 3,
        minWithdrawalAmount: 10,
        dailyWithdrawalCap: 1000
      }
    });
    const affiliateConfig = await prisma.affiliateConfig.findFirst();

    assert.equal(commissionFrom(affiliateConfig, 'CTVET_NABTEX'), 3);
    assert.equal(commissionFrom(affiliateConfig, 'BECE'), 5);
    assert.equal(commissionFrom(affiliateConfig, 'WASSCE_NOVDEC'), 9);
  });

  it('falls back to its own default when nothing is configured', () => {
    // Not 2.00, which is the WASSCE default the old two-way check would have used
    assert.equal(commissionFrom(null, 'CTVET_NABTEX'), 1.5);
  });
});

describe('the results link in the delivery SMS', () => {
  it('never points CTVET/NABTEX customers at a WAEC portal', () => {
    const ctvetUrl = resultsUrlFor('CTVET_NABTEX');
    assert.notEqual(ctvetUrl, resultsUrlFor('BECE'));
    assert.notEqual(ctvetUrl, resultsUrlFor('WASSCE_NOVDEC'));
    // Until a portal is configured it is null, and callers omit the line
    assert.equal(ctvetUrl, null);
  });

  it('still gives the WAEC links to the exams WAEC runs', () => {
    assert.match(resultsUrlFor('BECE'), /waecgh\.org/);
    assert.match(resultsUrlFor('WASSCE_NOVDEC'), /waecdirect\.org/);
  });
});

describe('the USSD menu', () => {
  const config = { becePrice: 20, wassceNovdecPrice: 25, ctvetNabtexPrice: 18 };

  it('offers each voucher type as options 1 to 3', () => {
    const menu = mainMenu(config);
    assert.deepEqual(menu.buyOptions, [
      { key: '1', voucherType: 'BECE' },
      { key: '2', voucherType: 'WASSCE_NOVDEC' },
      { key: '3', voucherType: 'CTVET_NABTEX' }
    ]);
  });

  it('shifts the fixed options down to 4, 5 and 6', () => {
    const menu = mainMenu(config);
    assert.equal(menu.transactions, '4');
    assert.equal(menu.releaseDates, '5');
    assert.equal(menu.support, '6');
  });

  it('shows each type with its own price', () => {
    const text = mainMenu(config).text();
    assert.match(text, /1\. Buy BECE \(GHS 20\.00\)/);
    assert.match(text, /2\. Buy WASSCE\/NOVDEC \(GHS 25\.00\)/);
    assert.match(text, /3\. Buy CTVET\/NABTEX \(GHS 18\.00\)/);
  });

  it('stays inside the length a USSD screen can show', () => {
    // Hubtel truncates around 160 characters
    assert.ok(mainMenu(config).text().length <= 160, `menu is ${mainMenu(config).text().length} chars`);
  });

  it('maps a keypress to the right type, and rejects anything else', () => {
    assert.equal(voucherTypeForKey('3'), 'CTVET_NABTEX');
    assert.equal(voucherTypeForKey('4'), null);
    assert.equal(voucherTypeForKey('0'), null);
    assert.equal(voucherTypeForKey('x'), null);
  });

  it('numbers the release-date submenu the same way', () => {
    const submenu = releaseDateMenu();
    assert.match(submenu.text, /3\. CTVET\/NABTEX Results/);
    assert.equal(submenu.voucherTypeForKey('3'), 'CTVET_NABTEX');
  });
});

describe('buying CTVET/NABTEX over USSD', () => {
  const MOBILE = '233249990123';

  const dial = (body) => app.request('POST', '/api/ussd/interaction', {
    body: { Operator: 'mtn', ...body },
    ip: HUBTEL_IP
  });

  it('reaches the confirmation screen at its own price', async () => {
    await createVoucher('CTVET_NABTEX');
    const config = await prisma.voucherConfig.findFirst();

    const start = await dial({ Type: 'Initiation', Message: '*713#', Mobile: MOBILE, SessionId: crypto.randomUUID() });
    assert.equal(start.status, 200);
    assert.match(start.body.Message, /3\. Buy CTVET\/NABTEX/);

    const sessionId = crypto.randomUUID();
    const init = await dial({ Type: 'Initiation', Message: '*713#', Mobile: MOBILE, SessionId: sessionId });

    const chosen = await dial({
      Type: 'Response',
      Message: '3',
      Mobile: MOBILE,
      SessionId: sessionId,
      ClientState: init.body.ClientState
    });

    assert.equal(chosen.status, 200);
    assert.match(chosen.body.Message, /CTVET\/NABTEX/);
    assert.match(
      chosen.body.Message,
      new RegExp(`GHS ${Number(config.ctvetNabtexPrice).toFixed(2)}`),
      `confirmation should quote the CTVET price, got: ${chosen.body.Message}`
    );
  });

  it('records the dialer against CTVET/NABTEX, not another type', async () => {
    await createVoucher('CTVET_NABTEX');

    const sessionId = crypto.randomUUID();
    const init = await dial({ Type: 'Initiation', Message: '*713#', Mobile: MOBILE, SessionId: sessionId });
    await dial({
      Type: 'Response',
      Message: '3',
      Mobile: MOBILE,
      SessionId: sessionId,
      ClientState: init.body.ClientState
    });

    // Tracking is fire-and-forget, so give it a moment to land
    let dialer = null;
    for (let attempt = 0; attempt < 25 && !dialer; attempt++) {
      dialer = await prisma.ussdDialer.findFirst({ where: { phoneNumber: MOBILE } });
      if (!dialer) await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.ok(dialer, 'the dialer should have been recorded');
    assert.equal(dialer.voucherType, 'CTVET_NABTEX');
  });

  it('says it is out of stock rather than selling nothing', async () => {
    // No CTVET vouchers loaded, but the other types have stock
    await createVoucher('BECE');

    const sessionId = crypto.randomUUID();
    const init = await dial({ Type: 'Initiation', Message: '*713#', Mobile: MOBILE, SessionId: sessionId });
    const chosen = await dial({
      Type: 'Response',
      Message: '3',
      Mobile: MOBILE,
      SessionId: sessionId,
      ClientState: init.body.ClientState
    });

    assert.match(chosen.body.Message, /CTVET\/NABTEX vouchers are currently out of stock/);
  });

  it('still reaches Support on its new number', async () => {
    const sessionId = crypto.randomUUID();
    const init = await dial({ Type: 'Initiation', Message: '*713#', Mobile: MOBILE, SessionId: sessionId });
    const support = await dial({
      Type: 'Response',
      Message: '6',
      Mobile: MOBILE,
      SessionId: sessionId,
      ClientState: init.body.ClientState
    });

    assert.match(support.body.Message, /support/i);
  });
});

describe('the public pricing endpoint', () => {
  it('lists every voucher type with its own price', async () => {
    const res = await app.request('GET', '/api/vouchers/configs/public', { ip: uniqueIp() });
    assert.equal(res.status, 200);

    const types = res.body.data.types;
    assert.ok(Array.isArray(types), 'expected a types array');
    assert.deepEqual(types.map((t) => t.type), ['BECE', 'WASSCE_NOVDEC', 'CTVET_NABTEX']);

    const ctvet = types.find((t) => t.type === 'CTVET_NABTEX');
    assert.equal(ctvet.displayName, 'CTVET/NABTEX');
    assert.ok(ctvet.price > 0, 'CTVET/NABTEX should carry a price');
  });
});
