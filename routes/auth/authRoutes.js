import { Router } from 'express';
import {
  login,
  refresh,
  logout,
  forgotPassword,
  validateOtp,
  resetPassword,
  changePassword,
  completeTwoFactorLogin,
  getTwoFactorStatus,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactorSignIn,
  regenerateRecoveryCodes
} from '../../controllers/auth/authController.js';
import {
  registerAffiliate,
  loginAffiliate
} from '../../controllers/auth/affiliateAuthController.js';
import { protect } from '../../middlewares/auth/authMiddleware.js';
import { validateBody } from '../../middlewares/validation/validate.js';
import {
  loginLimiter,
  passwordResetLimiter,
  sessionLimiter,
  registrationLimiter,
  twoFactorLimiter
} from '../../middlewares/security/rateLimiters.js';
import {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  validateOtpSchema,
  resetPasswordSchema,
  changePasswordSchema,
  affiliateRegisterSchema,
  twoFactorLoginSchema,
  twoFactorSetupSchema,
  twoFactorEnableSchema,
  twoFactorConfirmSchema
} from '../../validators/schemas.js';

const router = Router();

// Endpoint for user login
router.post('/login', loginLimiter, validateBody(loginSchema), login);

// Second login step for accounts with two-factor sign-in
router.post('/login/two-factor', twoFactorLimiter, validateBody(twoFactorLoginSchema), completeTwoFactorLogin);

// Two-factor management (signed in)
router.get('/two-factor', protect, getTwoFactorStatus);
router.post('/two-factor/setup', protect, validateBody(twoFactorSetupSchema), setupTwoFactor);
router.post('/two-factor/enable', protect, twoFactorLimiter, validateBody(twoFactorEnableSchema), enableTwoFactor);
router.post('/two-factor/disable', protect, twoFactorLimiter, validateBody(twoFactorConfirmSchema), disableTwoFactorSignIn);
router.post('/two-factor/recovery-codes', protect, twoFactorLimiter, validateBody(twoFactorConfirmSchema), regenerateRecoveryCodes);

// Endpoint for refreshing access token
router.post('/refresh', sessionLimiter, validateBody(refreshSchema), refresh);

// Endpoint for logging out
router.post('/logout', sessionLimiter, validateBody(refreshSchema), logout);

// Endpoint for forgot password (sends OTP by SMS)
router.post('/forgot-password', passwordResetLimiter, validateBody(forgotPasswordSchema), forgotPassword);

// Endpoint for validating OTP
router.post('/validate-otp', passwordResetLimiter, validateBody(validateOtpSchema), validateOtp);

// Endpoint for resetting password
router.post('/reset-password', passwordResetLimiter, validateBody(resetPasswordSchema), resetPassword);

// Endpoint for changing password (authenticated users)
router.patch('/change-password', protect, validateBody(changePasswordSchema), changePassword);

// Affiliate Auth Endpoints
router.post('/affiliate/register', registrationLimiter, validateBody(affiliateRegisterSchema), registerAffiliate);
router.post('/affiliate/login', loginLimiter, validateBody(loginSchema), loginAffiliate);

export default router;
