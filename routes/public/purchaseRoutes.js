import { Router } from 'express';
import { verifyPaymentStatus } from '../../controllers/public/orderController.js';
import { paymentVerifyLimiter } from '../../middlewares/security/rateLimiters.js';

const router = Router();

// Route to verify purchase payment status via query param
router.get('/verify', paymentVerifyLimiter, verifyPaymentStatus);

export default router;
