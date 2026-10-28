import { checkHubtelPayoutStatus } from '../utils/payment/hubtelHelper.js';
import dotenv from 'dotenv';

dotenv.config();

const ref = process.argv[2];
if (!ref) {
  console.error('Usage: node scripts/check_payout_status.js <transaction reference>');
  process.exit(1);
}

async function run() {
  console.log(`Checking Hubtel payout status for reference: ${ref}...`);
  const res = await checkHubtelPayoutStatus(ref);
  console.log('Result:', JSON.stringify(res, null, 2));
}

run();
