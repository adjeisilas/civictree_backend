import { Router } from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import { getCustomers, getCustomerByPhoneNumber, getCustomerStats } from '../../controllers/admin/customerController.js';

const router = Router();

// Get customer statistics
router.get('/stats', protect, restrictTo('ADMIN'), getCustomerStats);

// List all customers with filters and pagination
router.get('/', protect, restrictTo('ADMIN'), getCustomers);

// Get details of a single customer by phone number
router.get('/:phoneNumber', protect, restrictTo('ADMIN'), getCustomerByPhoneNumber);

export default router;
