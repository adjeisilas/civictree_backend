import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_ID = process.env.HUBTEL_PAYMENT_API_ID;
const API_KEY = process.env.HUBTEL_PAYMENT_API_KEY;
const MERCHANT_ACCOUNT = process.env.HUBTEL_PAYMENT_DISBURSEMENT_ACCOUNT_NUMBER || process.env.HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER;
const TARGET_WEBHOOK_URL = 'https://webhook.site/5d706ba2-ebe4-4cc3-b616-fefe532b7a9c';

async function sendWebhookTest() {
  console.log('====================================================');
  console.log('       SENDING TEST PAYLOAD TO HUBTEL WEBHOOK      ');
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

  const authHeader = API_ID && API_KEY ? `Basic ${Buffer.from(`${API_ID}:${API_KEY}`).toString('base64')}` : 'Basic NOT_SET';

  const payload = {
    testName: 'Hubtel Whitelist & Header Verification',
    timestamp: new Date().toISOString(),
    serverOutboundIp: publicIp,
    merchantAccountNumber: MERCHANT_ACCOUNT,
    apiIdPrefix: API_ID ? API_ID.substring(0, 4) + '***' : 'NOT_SET',
    message: 'Diagnostic test post from CivicTree backend server'
  };

  console.log(`[2] Target Webhook URL: ${TARGET_WEBHOOK_URL}`);
  console.log(`[3] Sending Payload:`, JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(TARGET_WEBHOOK_URL, payload, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'CivicTree-Backend-Diagnostic/1.0'
      },
      timeout: 10000
    });

    console.log('\n----------------------------------------------------');
    console.log(`SUCCESS! Status Code: ${response.status} ${response.statusText}`);
    console.log('Response Body:', response.data);
    console.log('----------------------------------------------------');
    console.log('\n--> HTTP POST successfully sent to Webhook.site!');
    console.log('Hubtel support can now inspect the request and verify the IP.');
  } catch (error) {
    console.log('\n----------------------------------------------------');
    console.log(`FAILED! Status Code: ${error.response?.status || 'No Response'}`);
    console.log('Error Message:', error.message);
    console.log('----------------------------------------------------');
  }
}

sendWebhookTest();
