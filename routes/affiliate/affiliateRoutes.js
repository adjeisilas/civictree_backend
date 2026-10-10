import { Router } from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import {
  getAffiliateDashboard,
  getAffiliateSales,
  getAffiliateEarnings,
  getAffiliateWithdrawals,
  requestWithdrawal,
  getAffiliateProfile,
  updateAffiliateProfile,
  updatePaymentDetails
} from '../../controllers/affiliate/affiliatePortalController.js';
import { validateBody } from '../../middlewares/validation/validate.js';
import {
  withdrawalRequestSchema,
  updatePayoutDetailsSchema,
  updateAffiliateProfileSchema
} from '../../validators/schemas.js';

const router = Router();

// Affiliate Portal Endpoints (accessible by both AFFILIATE and ADMIN)
router.get('/dashboard', protect, restrictTo('AFFILIATE', 'ADMIN'), getAffiliateDashboard);
router.get('/sales', protect, restrictTo('AFFILIATE', 'ADMIN'), getAffiliateSales);
router.get('/earnings', protect, restrictTo('AFFILIATE', 'ADMIN'), getAffiliateEarnings);
router.get('/withdrawals', protect, restrictTo('AFFILIATE', 'ADMIN'), getAffiliateWithdrawals);
router.post('/withdrawals', protect, restrictTo('AFFILIATE', 'ADMIN'), validateBody(withdrawalRequestSchema), requestWithdrawal);
router.get('/profile', protect, restrictTo('AFFILIATE', 'ADMIN'), getAffiliateProfile);
router.patch('/profile', protect, restrictTo('AFFILIATE', 'ADMIN'), validateBody(updateAffiliateProfileSchema), updateAffiliateProfile);
router.patch('/profile/payment', protect, restrictTo('AFFILIATE', 'ADMIN'), validateBody(updatePayoutDetailsSchema), updatePaymentDetails);

export default router;
