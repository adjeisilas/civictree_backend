import { Router } from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import { getOrders, getOrderById, getOrderStats, verifyOrderPaymentStatus } from '../../controllers/admin/orderController.js';

const router = Router();

// Retrieve aggregated statistics for orders
router.get('/stats', protect, restrictTo('ADMIN'), getOrderStats);

// List all orders with filters and pagination
router.get('/', protect, restrictTo('ADMIN'), getOrders);

// Get details of a single order by ID
router.get('/:id', protect, restrictTo('ADMIN'), getOrderById);

// Verify and reconcile payment status manually
router.post('/:id/verify-payment', protect, restrictTo('ADMIN'), verifyOrderPaymentStatus);

export default router;

