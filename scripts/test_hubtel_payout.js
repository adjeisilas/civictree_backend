import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_ID = process.env.HUBTEL_PAYMENT_API_ID;
const API_KEY = process.env.HUBTEL_PAYMENT_API_KEY;
const MERCHANT_ACCOUNT = process.env.HUBTEL_PAYMENT_DISBURSEMENT_ACCOUNT_NUMBER || process.env.HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER;

async function runMultiEndpointTest() {
  console.log('====================================================');
  console.log('       HUBTEL MULTI-ENDPOINT DIAGNOSTIC AUDIT       ');
  console.log('====================================================\n');

  // 1. Fetch Outbound Public IP
  let publicIp = 'Unknown';
  try {
    const ipRes = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    publicIp = ipRes.data.ip;
    console.log(`[1] Server Outbound Public IP: ${publicIp}`);
  } catch (err) {
    console.log(`[1] Server Outbound Public IP: Could not determine (${err.message})`);
  }

  console.log(`[2] Merchant Account: ${MERCHANT_ACCOUNT}`);
  console.log(`[2] API ID: ${API_ID ? API_ID.substring(0, 4) + '***' : 'NOT SET'}\n`);

  if (!API_ID || !API_KEY || !MERCHANT_ACCOUNT) {
    console.error('ERROR: Missing Hubtel environment variables in .env');
    process.exit(1);
  }

  const authHeader = `Basic ${Buffer.from(`${API_ID}:${API_KEY}`).toString('base64')}`;

  const tests = [
    {
      name: '1. Online Checkout (payproxyapi.hubtel.com)',
      url: 'https://payproxyapi.hubtel.com/items/initiate',
      method: 'POST',
      payload: {
        totalAmount: 1,
        description: 'Test Audit',
        callbackUrl: 'https://api.civictreegh.com/api/orders/webhook',
        returnUrl: 'https://civictreegh.com',
        merchantAccountNumber: MERCHANT_ACCOUNT,
        cancellationUrl: 'https://civictreegh.com',
        clientReference: `audit_chk_${Date.now()}`
      }
    },
    {
      name: '2. Receive Money (rmp.hubtel.com)',
      url: `https://rmp.hubtel.com/merchantaccount/merchants/${MERCHANT_ACCOUNT}/receive/mobilemoney`,
      method: 'POST',
      payload: {
        CustomerName: 'Audit Test',
        CustomerMsisdn: '233240000000',
        CustomerEmail: 'test@example.com',
        Channel: 'mtn-gh',
        Amount: 1,
        PrimaryCallbackUrl: 'https://api.civictreegh.com/api/orders/webhook',
        Description: 'Audit Test',
        ClientReference: `audit_rmp_${Date.now()}`
      }
    },
    {
      name: '3. Transaction Status Check (api-txnstatus.hubtel.com)',
      url: `https://api-txnstatus.hubtel.com/transactions/${MERCHANT_ACCOUNT}/status?clientReference=test_ref`,
      method: 'GET'
    },
    {
      name: '4. Direct Send Money (smp.hubtel.com)',
      url: `https://smp.hubtel.com/api/merchants/${MERCHANT_ACCOUNT}/send/mobilemoney`,
      method: 'POST',
      payload: {
        RecipientName: 'Audit Test',
        RecipientMsisdn: '233240000000',
        CustomerEmail: 'test@example.com',
        Channel: 'mtn-gh',
        Amount: 1,
        PrimaryCallbackURL: 'https://api.civictreegh.com/api/admin/affiliates/withdrawals/webhook',
        Description: 'Audit Test',
        ClientReference: `audit_smp_${Date.now()}`
      }
    }
  ];

  for (const t of tests) {
    console.log(`--- Testing Endpoint: ${t.name} ---`);
    console.log(`URL: ${t.url}`);
    try {
      let res;
      if (t.method === 'POST') {
        res = await axios.post(t.url, t.payload, {
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'User-Agent': 'CivicTree/1.0' },
          timeout: 10000
        });
      } else {
        res = await axios.get(t.url, {
          headers: { 'Authorization': authHeader, 'Accept': 'application/json', 'User-Agent': 'CivicTree/1.0' },
          timeout: 10000
        });
      }
      console.log(`RESULT: SUCCESS! Status Code: ${res.status}`);
      console.log(`Response:`, JSON.stringify(res.data, null, 2));
    } catch (err) {
      console.log(`RESULT: FAILED! Status Code: ${err.response?.status || 'No Response'}`);
      console.log(`Server Header: ${err.response?.headers?.server || 'N/A'}`);
      if (err.response?.data) {
        console.log(`Response Body:`, typeof err.response.data === 'object' ? JSON.stringify(err.response.data, null, 2) : String(err.response.data).substring(0, 300));
      } else {
        console.log(`Error Message: ${err.message}`);
      }
    }
    console.log('\n');
  }

  console.log('====================================================');
}

runMultiEndpointTest();
