import { Router } from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import { getReportStats } from '../../controllers/admin/reportController.js';

const router = Router();

// Retrieve aggregated report statistics
router.get('/stats', protect, restrictTo('ADMIN'), getReportStats);

export default router;
