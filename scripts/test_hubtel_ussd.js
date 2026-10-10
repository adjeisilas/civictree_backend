import { prisma } from '../config/config.js';
import { handleUssdInteraction, handleUssdFulfillment } from '../controllers/public/ussdController.js';

// Setup mock request/response objects
function createMockRequest(body) {
  return {
    body,
    ip: '127.0.0.1',
    headers: {}
  };
}

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (obj) {
      this.data = obj;
      return this;
    }
  };
  return res;
}

async function runUssdTests() {
  console.log('=== HUBTEL USSD PROGRAMMABLE SERVICES TEST ===\n');

  // Seed configuration & vouchers if not present
  // Seed configuration & vouchers if not present
  let config = await prisma.voucherConfig.findFirst();
  if (!config) {
    console.log('Seeding temporary pricing configuration...');
    config = await prisma.voucherConfig.create({
      data: {
        wassceNovdecPrice: 18.00,
        becePrice: 12.00,
        wassceNovdecReleaseDate: new Date('2026-10-15T00:00:00Z'),
        beceReleaseDate: new Date('2026-09-20T00:00:00Z')
      }
    });
  } else {
    // Make sure date values exist for config
    config = await prisma.voucherConfig.update({
      where: { id: config.id },
      data: {
        wassceNovdecReleaseDate: new Date('2026-10-15T00:00:00Z'),
        beceReleaseDate: new Date('2026-09-20T00:00:00Z')
      }
    });
  }

  const wassceVoucherCount = await prisma.voucher.count({
    where: { type: 'WASSCE_NOVDEC', status: 'AVAILABLE' }
  });

  if (wassceVoucherCount === 0) {
    console.log('Seeding temporary WASSCE/NOVDEC vouchers for testing...');
    await prisma.voucher.createMany({
      data: [
        { type: 'WASSCE_NOVDEC', serialNumber: `TEST-SN-${Date.now()}-1`, pin: '111111', status: 'AVAILABLE' },
        { type: 'WASSCE_NOVDEC', serialNumber: `TEST-SN-${Date.now()}-2`, pin: '222222', status: 'AVAILABLE' }
      ]
    });
  }

  const SessionId1 = `test-session-buy-${Date.now()}`;
  const Mobile = '233257581661';
  const Operator = 'mtn';

  // ==========================================
  // PATH 1: BUY VOUCHERS & FULFILL
  // ==========================================
  console.log('=== PATH 1: Buying Vouchers & Fulfill ===');

  // STEP 1.1: Initiation
  console.log('--- Step 1.1: Session Initiation ---');
  let req = createMockRequest({
    Type: 'Initiation',
    Mobile,
    SessionId: SessionId1,
    ServiceCode: '713',
    Message: '*713#',
    Operator,
    Sequence: 1,
    ClientState: ''
  });
  let res = createMockResponse();

  await handleUssdInteraction(req, res, (err) => console.error(err));
  console.log('Initiation Response:', JSON.stringify(res.data, null, 2));
  console.log('\n----------------------------------------\n');

  // STEP 1.2: Choose BECE (Choice '1')
  console.log('--- Step 1.2: Selecting Buy BECE (Option 1) ---');
  req = createMockRequest({
    Type: 'Response',
    Mobile,
    SessionId: SessionId1,
    ServiceCode: '713',
    Message: '1',
    Operator,
    Sequence: 2,
    ClientState: res.data.ClientState
  });
  res = createMockResponse();

  await handleUssdInteraction(req, res, (err) => console.error(err));
  console.log('Selection/Confirmation Response:', JSON.stringify(res.data, null, 2));
  console.log('\n----------------------------------------\n');

  // STEP 1.3: Confirm Payment (Choice '1')
  console.log('--- Step 1.3: Confirming Payment ---');
  req = createMockRequest({
    Type: 'Response',
    Mobile,
    SessionId: SessionId1,
    ServiceCode: '713',
    Message: '1',
    Operator,
    Sequence: 3,
    ClientState: res.data.ClientState
  });
  res = createMockResponse();

  await handleUssdInteraction(req, res, (err) => console.error(err));
  console.log('Payment Prompt Response:', JSON.stringify(res.data, null, 2));
  console.log('\n----------------------------------------\n');

  // STEP 1.5: Service Fulfillment
  console.log('--- Step 1.5: Simulating Service Fulfillment ---');
  const order = await prisma.order.findUnique({
    where: { transactionId: SessionId1 }
  });

  if (order) {
    console.log(`Created Local Order Found: ${order.id}`);
    req = createMockRequest({
      SessionId: SessionId1,
      OrderId: `hubtel-tx-${Date.now()}`,
      OrderInfo: {
        CustomerMobileNumber: Mobile,
        CustomerName: 'USSD Customer',
        Status: 'Paid',
        Subtotal: order.amount,
        Items: [
          {
            Name: `1 x ${order.voucherType} Voucher`,
            Quantity: order.quantity,
            UnitPrice: Number(order.amount)
          }
        ],
        Payment: {
          PaymentType: 'mobilemoney',
          AmountPaid: order.amount,
          IsSuccessful: true
        }
      }
    });
    res = createMockResponse();

    await handleUssdFulfillment(req, res, (err) => console.error(err));
    console.log('Fulfillment Response:', JSON.stringify(res.data, null, 2));

    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { vouchers: true }
    });
    console.log(`Updated Order Payment Status: ${updatedOrder.paymentStatus}`);
    console.log(`Allocated Vouchers Count: ${updatedOrder.vouchers.length}`);
  } else {
    console.error('Test Error: Local order was not created.');
  }
  console.log('\n----------------------------------------\n');

  // ==========================================
  // PATH 2: EXAM RESULTS RELEASE DATE
  // ==========================================
  console.log('=== PATH 2: Checking Exam Results Release Dates ===');
  const SessionId2 = `test-session-dates-${Date.now()}`;

  // STEP 2.1: Initiation
  req = createMockRequest({
    Type: 'Initiation',
    Mobile,
    SessionId: SessionId2,
    ServiceCode: '713',
    Message: '*713#',
    Operator,
    Sequence: 1,
    ClientState: ''
  });
  res = createMockResponse();
  await handleUssdInteraction(req, res, (err) => console.error(err));

  // STEP 2.2: Select Option 4
  req = createMockRequest({
    Type: 'Response',
    Mobile,
    SessionId: SessionId2,
    ServiceCode: '713',
    Message: '4',
    Operator,
    Sequence: 2,
    ClientState: res.data.ClientState
  });
  res = createMockResponse();
  await handleUssdInteraction(req, res, (err) => console.error(err));
  console.log('Exam Release Dates Screen Response:', JSON.stringify(res.data, null, 2));
  console.log('\n----------------------------------------\n');

  // ==========================================
  // PATH 3: TRANSACTIONS HISTORY
  // ==========================================
  console.log('=== PATH 3: Checking Transactions History ===');
  const SessionId3 = `test-session-txs-${Date.now()}`;

  // STEP 3.1: Initiation
  req = createMockRequest({
    Type: 'Initiation',
    Mobile,
    SessionId: SessionId3,
    ServiceCode: '713',
    Message: '*713#',
    Operator,
    Sequence: 1,
    ClientState: ''
  });
  res = createMockResponse();
  await handleUssdInteraction(req, res, (err) => console.error(err));

  // STEP 3.2: Select Option 3
  req = createMockRequest({
    Type: 'Response',
    Mobile,
    SessionId: SessionId3,
    ServiceCode: '713',
    Message: '3',
    Operator,
    Sequence: 2,
    ClientState: res.data.ClientState
  });
  res = createMockResponse();
  await handleUssdInteraction(req, res, (err) => console.error(err));
  console.log('Transactions List Screen Response:', JSON.stringify(res.data, null, 2));
  console.log('\n----------------------------------------\n');

  // STEP 3.3: Select Transaction 1 from the list
  if (res.data.ClientState && res.data.ClientState.startsWith('TX_SELECT:')) {
    req = createMockRequest({
      Type: 'Response',
      Mobile,
      SessionId: SessionId3,
      ServiceCode: '713',
      Message: '1',
      Operator,
      Sequence: 3,
      ClientState: res.data.ClientState
    });
    res = createMockResponse();
    await handleUssdInteraction(req, res, (err) => console.error(err));
    console.log('Voucher Details Screen Response:', JSON.stringify(res.data, null, 2));
  } else {
    console.error('Test Error: No transaction list state received.');
  }
  console.log('\n----------------------------------------\n');

  // ==========================================
  // PATH 4: HELP/SUPPORT
  // ==========================================
  console.log('=== PATH 4: Checking Help/Support Option ===');
  const SessionId4 = `test-session-support-${Date.now()}`;

  // STEP 4.1: Initiation
  req = createMockRequest({
    Type: 'Initiation',
    Mobile,
    SessionId: SessionId4,
    ServiceCode: '713',
    Message: '*713#',
    Operator,
    Sequence: 1,
    ClientState: ''
  });
  res = createMockResponse();
  await handleUssdInteraction(req, res, (err) => console.error(err));

  // STEP 4.2: Select Option 5
  req = createMockRequest({
    Type: 'Response',
    Mobile,
    SessionId: SessionId4,
    ServiceCode: '713',
    Message: '5',
    Operator,
    Sequence: 2,
    ClientState: res.data.ClientState
  });
  res = createMockResponse();
  await handleUssdInteraction(req, res, (err) => console.error(err));
  console.log('Support Screen Response:', JSON.stringify(res.data, null, 2));

  console.log('\n=== USSD Testing Completed ===');
  process.exit(0);
}

runUssdTests().catch((err) => {
  console.error('USSD Testing Uncaught Error:', err);
  process.exit(1);
});
