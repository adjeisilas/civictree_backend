import { checkHubtelPayoutStatus } from '../utils/payment/hubtelHelper.js';
import dotenv from 'dotenv';

dotenv.config();

const ref = process.argv[2] || 'fc23aba2e11840bd9dad325366185e9c';

async function run() {
  console.log(`Checking Hubtel payout status for reference: ${ref}...`);
  const res = await checkHubtelPayoutStatus(ref);
  console.log('Result:', JSON.stringify(res, null, 2));
}

run();
