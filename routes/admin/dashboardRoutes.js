import { Router } from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import { getDashboardStats } from '../../controllers/admin/dashboardController.js';

const router = Router();

// Retrieve aggregated dashboard statistics
router.get('/stats', protect, restrictTo('ADMIN'), getDashboardStats);

export default router;
