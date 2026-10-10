import { Router } from 'express';
import { getPublicTimetables } from '../../controllers/public/timetableController.js';

const router = Router();

// Public endpoint for published timetables
router.get('/', getPublicTimetables);

export default router;
