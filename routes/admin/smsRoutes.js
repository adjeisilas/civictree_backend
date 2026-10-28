import { Router } from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import { sendBulkSMS, sendSingleSMS, sendBECEBulkSMS, sendWASSCEBulkSMS, sendCtvetNabtexBulkSMS, getBulkSMSRecipientCount, getSmsContactSummary, clearSmsContactList } from '../../controllers/admin/smsController.js';

const router = Router();

// Contact counts per voucher type, and when each was last cleared
router.get('/contacts', protect, restrictTo('ADMIN'), getSmsContactSummary);

// Clear contacts so new ones can accumulate. ?voucherType=BECE for one product,
// omitted or ALL for every type. Orders are never deleted.
router.delete('/contacts', protect, restrictTo('ADMIN'), clearSmsContactList);

// How many people a campaign would reach, before anyone pays to send it
router.get('/recipients/count', protect, restrictTo('ADMIN'), getBulkSMSRecipientCount);

// Send BECE bulk SMS campaign
router.post('/bulk/bece', protect, restrictTo('ADMIN'), sendBECEBulkSMS);

// Send WASSCE bulk SMS campaign
router.post('/bulk/wassce', protect, restrictTo('ADMIN'), sendWASSCEBulkSMS);

// Send CTVET/NABTEX bulk SMS campaign
router.post('/bulk/ctvet-nabtex', protect, restrictTo('ADMIN'), sendCtvetNabtexBulkSMS);

// Send legacy / general bulk SMS campaign
router.post('/bulk', protect, restrictTo('ADMIN'), sendBulkSMS);

// Send direct single SMS to any custom phone number
router.post('/single', protect, restrictTo('ADMIN'), sendSingleSMS);

export default router;
