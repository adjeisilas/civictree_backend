import { Router } from 'express';
import { getAllActivityLogs, getActivityLogById } from '../../controllers/admin/activityLogController.js';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';

const router = Router();

router.get('/', protect, restrictTo('ADMIN'), getAllActivityLogs);
router.get('/:id', protect, restrictTo('ADMIN'), getActivityLogById);

export default router;
