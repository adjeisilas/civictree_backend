import { Router } from 'express';
import {
  handleAffiliateUssdInteraction,
  handleAffiliateUssdFulfillment
} from '../../controllers/public/affiliateUssdController.js';
import { hubtelOnly } from '../../middlewares/hubtel/hubtelOnly.js';

const router = Router();

// Affiliate USSD session interaction callback
router.post('/interaction', hubtelOnly, handleAffiliateUssdInteraction);

// Affiliate USSD payment fulfillment callback
router.post('/fulfillment', hubtelOnly, handleAffiliateUssdFulfillment);

export default router;
