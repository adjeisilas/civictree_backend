import { Router } from 'express';
import {
  subscribePush,
  unsubscribePush,
  getAllNotifications,
  getNotificationById,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getNotificationTypes
} from '../../controllers/admin/notificationController.js';
import { protect } from '../../middlewares/auth/authMiddleware.js';

const router = Router();

// Push notification subscription routes
router.post('/push/subscribe', protect, subscribePush);
router.post('/push/unsubscribe', protect, unsubscribePush);

// Notification management routes
router.get('/', protect, getAllNotifications);
router.get('/types', protect, getNotificationTypes);
router.patch('/read-all', protect, markAllNotificationsAsRead);
router.get('/:id', protect, getNotificationById);
router.patch('/:id/read', protect, markNotificationAsRead);

export default router;
