import { Router } from 'express';
import multer from 'multer';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import {
  getAdminTimetables,
  updateTimetable
} from '../../controllers/admin/timetableController.js';

const router = Router();

// Multer memory storage configuration for timetable PDF/DOC/DOCX uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /pdf|doc|docx|application\/pdf|application\/msword|application\/vnd.openxmlformats-officedocument.wordprocessingml.document/i;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(file.originalname.split('.').pop());

    if (mimetype || extname) {
      return cb(null, true);
    }
    cb(Object.assign(new Error('Only PDF (.pdf) and Word document (.doc, .docx) files are allowed!'), { isUploadValidationError: true }));
  },
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB file limit
});

// Admin Timetable Management Endpoints
router.get('/', protect, restrictTo('ADMIN'), getAdminTimetables);
router.patch('/:type', protect, restrictTo('ADMIN'), upload.single('file'), updateTimetable);

export default router;
