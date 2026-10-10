import { Router } from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import { sendBulkSMS, sendSingleSMS, sendBECEBulkSMS, sendWASSCEBulkSMS, getBulkSMSRecipientCount } from '../../controllers/admin/smsController.js';

const router = Router();

// How many people a campaign would reach, before anyone pays to send it
router.get('/recipients/count', protect, restrictTo('ADMIN'), getBulkSMSRecipientCount);

// Send BECE bulk SMS campaign
router.post('/bulk/bece', protect, restrictTo('ADMIN'), sendBECEBulkSMS);

// Send WASSCE bulk SMS campaign
router.post('/bulk/wassce', protect, restrictTo('ADMIN'), sendWASSCEBulkSMS);

// Send legacy / general bulk SMS campaign
router.post('/bulk', protect, restrictTo('ADMIN'), sendBulkSMS);

// Send direct single SMS to any custom phone number
router.post('/single', protect, restrictTo('ADMIN'), sendSingleSMS);

export default router;
