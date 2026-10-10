import { sendSMS, sendBatchSMS } from '../utils/sms/smsHelper.js';

async function testSmsv2() {
  console.log('=== HUBTEL SMS GATEWAY V2 TEST ===');

  const testRecipient = '233257581661';

  // Test 1: Single SMS
  console.log('\n--- 1. Testing Single SMS Send ---');
  const singleResult = await sendSMS({
    to: testRecipient,
    message: 'Hello! This is a single test message from CiviTree using the new Hubtel SMS config.'
  });
  console.log('Single SMS Result:', singleResult);

  // Test 2: Batch SMS
  console.log('\n--- 2. Testing Batch SMS Send ---');
  const batchResult = await sendBatchSMS({
    recipients: [testRecipient],
    message: 'Hello! This is a batch test message sent via Hubtel Batch Simple Messaging.'
  });
  console.log('Batch SMS Result:', batchResult);
}

testSmsv2().catch(console.error);
