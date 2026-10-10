import { Router } from 'express';
import { getPublicVoucherConfigs } from '../../controllers/public/voucherController.js';

const router = Router();

// Public Voucher Config Route
router.get('/configs/public', getPublicVoucherConfigs);

export default router;
