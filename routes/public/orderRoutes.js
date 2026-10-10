import { Router } from 'express';
import { createOrder, hubtelWebhook } from '../../controllers/public/orderController.js';
import { hubtelOnly, requireHubtelCallbackToken } from '../../middlewares/hubtel/hubtelOnly.js';
import { orderCreationLimiter } from '../../middlewares/security/rateLimiters.js';
import { validateBody } from '../../middlewares/validation/validate.js';
import { createOrderSchema } from '../../validators/schemas.js';

const router = Router();

// Route to initiate a voucher purchase order
router.post('/', orderCreationLimiter, validateBody(createOrderSchema), createOrder);

// Webhook routes for Hubtel payment status updates.
// With HUBTEL_CALLBACK_TOKEN set, only /webhook/<token> is accepted.
router.post('/webhook', hubtelOnly, requireHubtelCallbackToken, hubtelWebhook);
router.post('/webhook/:token', hubtelOnly, requireHubtelCallbackToken, hubtelWebhook);

export default router;
