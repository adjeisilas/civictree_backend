import { Router } from 'express';
import {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  updateUserStatus,
  deleteUser
} from '../../controllers/admin/userController.js';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import { validateBody } from '../../middlewares/validation/validate.js';
import { createUserSchema, updateUserSchema } from '../../validators/schemas.js';

const router = Router();

router.post('/', protect, restrictTo('ADMIN'), validateBody(createUserSchema), createUser);
router.get('/', protect, restrictTo('ADMIN'), getAllUsers);
router.get('/:id', protect, restrictTo('ADMIN'), getUserById);
router.patch('/:id', protect, restrictTo('ADMIN'), validateBody(updateUserSchema), updateUser);
router.patch('/:id/status', protect, restrictTo('ADMIN'), updateUserStatus);
router.delete('/:id', protect, restrictTo('ADMIN'), deleteUser);

export default router;
