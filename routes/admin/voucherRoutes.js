import { Router } from 'express';
import multer from 'multer';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import {
  createVoucherConfig,
  getVoucherConfigs,
  updateVoucherConfig,
  updateVoucherReleaseDates,
  deleteVoucherConfig,
  uploadVouchersBulk,
  checkVouchersBulkDuplicates,
  uploadVoucherSingle,
  getAllVouchers,
  getVoucherById,
  revealVoucherPin,
  updateVoucher,
  deleteVoucher,
  getSoldVouchers,
  getUploadHistory,
  getUploadHistoryById,
  getVoucherOverview
} from '../../controllers/admin/voucherController.js';

const router = Router();

// Multer memory storage configuration for bulk CSV/Excel uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Checked by extension: the browser's declared type is not trustworthy.
    // The legacy .xls format is no longer supported (see utils/file/spreadsheet.js).
    const extension = file.originalname.split('.').pop().toLowerCase();

    if (['csv', 'xlsx'].includes(extension)) {
      return cb(null, true);
    }
    cb(Object.assign(
      new Error('Only .csv and .xlsx files are allowed. Save older .xls files as .xlsx first.'),
      { isUploadValidationError: true }
    ));
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit (roughly 200k voucher rows)
});

// Voucher Configuration Routes
router.post('/configs', protect, restrictTo('ADMIN'), createVoucherConfig);
router.get('/configs', protect, restrictTo('ADMIN'), getVoucherConfigs);
router.put('/configs', protect, restrictTo('ADMIN'), updateVoucherConfig);
router.put('/configs/release-dates', protect, restrictTo('ADMIN'), updateVoucherReleaseDates);
router.delete('/configs', protect, restrictTo('ADMIN'), deleteVoucherConfig);

// Voucher File/Manual Upload Routes
router.post('/upload-bulk', protect, restrictTo('ADMIN'), upload.single('file'), uploadVouchersBulk);
router.post('/check-bulk-duplicates', protect, restrictTo('ADMIN'), upload.single('file'), checkVouchersBulkDuplicates);
router.post('/upload-single', protect, restrictTo('ADMIN'), uploadVoucherSingle);

// Voucher Search and Analytics Routes
router.get('/overview', protect, restrictTo('ADMIN'), getVoucherOverview);
router.get('/upload-history', protect, restrictTo('ADMIN'), getUploadHistory);
router.get('/upload-history/:id', protect, restrictTo('ADMIN'), getUploadHistoryById);
router.get('/sold', protect, restrictTo('ADMIN'), getSoldVouchers);

// General Voucher CRUD Routes
router.get('/', protect, restrictTo('ADMIN'), getAllVouchers);
router.get('/:id', protect, restrictTo('ADMIN'), getVoucherById);
// Full PIN for one voucher; each reveal is recorded in the activity log
router.get('/:id/pin', protect, restrictTo('ADMIN'), revealVoucherPin);
router.patch('/:id', protect, restrictTo('ADMIN'), updateVoucher);
router.delete('/:id', protect, restrictTo('ADMIN'), deleteVoucher);

export default router;
