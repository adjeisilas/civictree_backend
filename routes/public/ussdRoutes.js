import { Router } from 'express';
import { handleUssdInteraction, handleUssdFulfillment } from '../../controllers/public/ussdController.js';
import { hubtelOnly } from '../../middlewares/hubtel/hubtelOnly.js';

const router = Router();

// Endpoint for Hubtel interactive USSD menu requests
router.post('/interaction', hubtelOnly, handleUssdInteraction);

// Endpoint for Hubtel payment fulfillment callback
router.post('/fulfillment', hubtelOnly, handleUssdFulfillment);

export default router;
