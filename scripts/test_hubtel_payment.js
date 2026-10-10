import 'dotenv/config';
import {
  initiateHubtelCheckout,
  initiateHubtelDirectDebit,
  checkHubtelTransactionStatus
} from '../utils/payment/hubtelHelper.js';

const testRecipientNumber = '233257581661'; // As specified in earlier requirements

async function runTests() {
  console.log('=== HUBTEL PAYMENT GATEWAY V2 TEST ===\n');

  // 1. Testing Online Checkout Initiation
  console.log('--- 1. Testing Online Checkout Initiation (payproxyapi) ---');
  try {
    const testOrderIdWeb = `WEB-TEST-${Date.now()}`;
    const checkoutResult = await initiateHubtelCheckout({
      orderId: testOrderIdWeb,
      amount: 0.1, // Small amount (GHS 0.10)
      phoneNumber: testRecipientNumber,
      customerName: 'Web Test User',
      voucherType: 'WASSCE_NOVDEC',
      quantity: 1
    });

    console.log('[SUCCESS] Checkout initiated successfully.');
    console.log('Checkout URL:', checkoutResult.checkoutUrl);
    console.log('Transaction ID / Checkout ID:', checkoutResult.transactionId);
  } catch (error) {
    console.error('[ERROR] Failed to initiate Online Checkout:', error.message);
  }

  console.log('\n----------------------------------------\n');

  // 2. Testing Direct Momo Debit Prompt (USSD/Direct Receive)
  console.log('--- 2. Testing Direct Momo Debit Prompt (rmp API) ---');
  try {
    const testOrderIdDirect = `DIR-TEST-${Date.now()}`;
    const directResult = await initiateHubtelDirectDebit({
      orderId: testOrderIdDirect,
      amount: 0.1,
      phoneNumber: testRecipientNumber,
      customerName: 'Direct Test User',
      channel: 'mtn-gh', // Explicit operator channel
      description: 'USSD test debit prompt'
    });

    console.log('[SUCCESS] Direct Momo debit prompt initiated successfully.');
    console.log('Response Message:', directResult.message);
    console.log('Transaction ID:', directResult.transactionId);
    console.log('Client Reference:', directResult.clientReference);
  } catch (error) {
    console.error('[ERROR] Failed to initiate Direct Momo Debit Prompt:', error.message);
  }

  console.log('\n----------------------------------------\n');

  // 3. Testing Transaction Status Check
  console.log('--- 3. Testing Transaction Status Check ---');
  try {
    // Check status of the order we just initiated or a fake one
    const checkReference = `DIR-TEST-123456789`;
    console.log(`Checking status for clientReference: ${checkReference}...`);
    const statusResult = await checkHubtelTransactionStatus(checkReference);

    console.log('[SUCCESS] Status check API called successfully.');
    console.log('Status Result:', JSON.stringify(statusResult, null, 2));
  } catch (error) {
    console.error('[ERROR] Failed to check transaction status:', error.message);
  }

  console.log('\n=== Testing Done ===');
}

runTests();

