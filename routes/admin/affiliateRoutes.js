import { Router } from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import {
  getAdminAffiliates,
  createAffiliateAdmin,
  getAdminAffiliateById,
  updateAffiliateStatus,
  updateAffiliateUssd,
  getAdminWithdrawalRequests,
  processWithdrawalRequest,
  getAffiliateConfig,
  updateAffiliateConfig,
  processAdminDirectWithdrawal,
  getAdminDirectWithdrawalsHistory,
  deleteAffiliateAdmin
} from '../../controllers/admin/affiliateController.js';

import { validateBody } from '../../middlewares/validation/validate.js';
import { processWithdrawalSchema, adminDirectWithdrawalSchema } from '../../validators/schemas.js';

const router = Router();

// Admin Affiliate Management Endpoints
router.get('/', protect, restrictTo('ADMIN'), getAdminAffiliates);
router.post('/', protect, restrictTo('ADMIN'), createAffiliateAdmin);

// System-wide Commission & Withdrawal Config Settings
router.get('/config', protect, restrictTo('ADMIN'), getAffiliateConfig);
router.patch('/config', protect, restrictTo('ADMIN'), updateAffiliateConfig);

// Affiliate Withdrawal Requests Management
router.get('/withdrawals', protect, restrictTo('ADMIN'), getAdminWithdrawalRequests);
router.patch('/withdrawals/:id', protect, restrictTo('ADMIN'), validateBody(processWithdrawalSchema), processWithdrawalRequest);

// Admin Direct Money Withdrawal (Immediate Disbursal)
router.post('/withdrawals/direct', protect, restrictTo('ADMIN'), validateBody(adminDirectWithdrawalSchema), processAdminDirectWithdrawal);
router.get('/withdrawals/direct', protect, restrictTo('ADMIN'), getAdminDirectWithdrawalsHistory);

// Specific Affiliate Profile Actions
router.get('/:id', protect, restrictTo('ADMIN'), getAdminAffiliateById);
router.patch('/:id/status', protect, restrictTo('ADMIN'), updateAffiliateStatus);
router.patch('/:id/ussd', protect, restrictTo('ADMIN'), updateAffiliateUssd);
router.delete('/:id', protect, restrictTo('ADMIN'), deleteAffiliateAdmin);

export default router;
