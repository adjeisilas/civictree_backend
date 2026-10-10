import express from 'express';
import { loginPartner, forgotPasswordPartner } from '../../controllers/auth/partnerAuthController.js';
import { validateBody } from '../../middlewares/validation/validate.js';
import { loginLimiter, passwordResetLimiter } from '../../middlewares/security/rateLimiters.js';
import { loginSchema, forgotPasswordSchema } from '../../validators/schemas.js';

const router = express.Router();

router.post('/login', loginLimiter, validateBody(loginSchema), loginPartner);
router.post('/forgot-password', passwordResetLimiter, validateBody(forgotPasswordSchema), forgotPasswordPartner);

export default router;
