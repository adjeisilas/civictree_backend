import express from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import {
  getAllPartners,
  createPartnerAdmin,
  getPartnerByIdAdmin,
  updatePartnerAdmin
} from '../../controllers/admin/partnerController.js';

const router = express.Router();

router.use(protect, restrictTo('ADMIN'));

router.get('/', getAllPartners);
router.post('/', createPartnerAdmin);
router.get('/:id', getPartnerByIdAdmin);
router.put('/', updatePartnerAdmin);

export default router;
