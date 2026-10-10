import express from 'express';
import { protect, restrictTo } from '../../middlewares/auth/authMiddleware.js';
import {
  getPartnerDashboard,
  getPartnerTransactions,
  getPartnerReports,
  getPartnerSettlements,
  requestPartnerSettlement,
  getPayoutAccounts,
  createPayoutAccount,
  getPartnerNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getPartnerProfile,
  updatePartnerProfile,
  changePartnerPassword,
  getPartnerSettings,
  updatePartnerSettings
} from '../../controllers/partner/partnerPortalController.js';

import { validateBody } from '../../middlewares/validation/validate.js';
import { partnerSettlementSchema } from '../../validators/schemas.js';

const router = express.Router();

// Protect all partner routes and restrict to PARTNER and ADMIN roles
router.use(protect, restrictTo('PARTNER', 'ADMIN'));

// Dashboard & Ledger
router.get('/dashboard', getPartnerDashboard);
router.get('/transactions', getPartnerTransactions);
router.get('/reports', getPartnerReports);

// Settlements & Payouts
router.get('/settlements', getPartnerSettlements);
router.post('/settlements/request', validateBody(partnerSettlementSchema), requestPartnerSettlement);
router.get('/payout-accounts', getPayoutAccounts);
router.post('/payout-accounts', createPayoutAccount);

// Notifications
router.get('/notifications', getPartnerNotifications);
router.patch('/notifications/:id/read', markNotificationRead);
router.post('/notifications/read-all', markAllNotificationsRead);

// Profile & Settings
router.get('/profile', getPartnerProfile);
router.put('/profile', updatePartnerProfile);
router.post('/change-password', changePartnerPassword);
router.get('/settings', getPartnerSettings);
router.put('/settings', updatePartnerSettings);

export default router;
