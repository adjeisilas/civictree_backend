import { Router } from 'express';
import { hubtelPayoutWebhook } from '../../controllers/public/payoutController.js';
import { hubtelOnly, requireHubtelCallbackToken } from '../../middlewares/hubtel/hubtelOnly.js';

const router = Router();

// Hubtel Send Money (payout) status callbacks.
// With HUBTEL_CALLBACK_TOKEN set, only /webhook/<token> is accepted.
router.post('/webhook', hubtelOnly, requireHubtelCallbackToken, hubtelPayoutWebhook);
router.post('/webhook/:token', hubtelOnly, requireHubtelCallbackToken, hubtelPayoutWebhook);

export default router;
