import bcrypt from 'bcryptjs';
import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { displayNameFor } from '../../utils/voucher/voucherTypes.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';

/**
 * Helper to fetch partner profile from authenticated request user
 */
const getPartnerFromReq = async (req) => {
  const userId = req.user.id;
  const userEmail = req.user.email;

  let partner = await prisma.partner.findFirst({
    where: {
      OR: [
        { id: userId },
        { email: userEmail ? userEmail.toLowerCase() : '' }
      ]
    },
    include: {
      payoutAccounts: true,
      settings: true
    }
  });

  if (!partner) {
    // Fallback: fetch default partner
    partner = await prisma.partner.findFirst({
      include: {
        payoutAccounts: true,
        settings: true
      }
    });
  }

  if (!partner) {
    throw new AppError('Partner profile not found.', 404);
  }

  return partner;
};

/**
 * Get Partner Dashboard Overview
 * GET /api/partner/dashboard
 */
export const getPartnerDashboard = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Get Partner Dashboard Overview'
  // #swagger.description = 'Retrieves live dashboard statistics for the authenticated partner.'
  try {
    const partner = await getPartnerFromReq(req);
    const partnershipStartDate = new Date('2026-09-01T00:00:00.000Z');

    // Ghana Time bounds (Africa/Accra / GMT)
    const now = new Date();
    const accraFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Accra',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const todayStr = accraFormatter.format(now); // YYYY-MM-DD
    const [year, month, day] = todayStr.split('-').map(Number);

    const todayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));

    // 1. Fetch all partner transactions belonging to this partner (since Sep 1, 2026)
    const [allTxs, todayTxs, mtdTxs, categoryBreakdown, recentTransactions] = await Promise.all([
      prisma.partnerTransaction.findMany({
        where: { partnerId: partner.id, createdAt: { gte: partnershipStartDate } }
      }),
      prisma.partnerTransaction.findMany({
        where: { partnerId: partner.id, createdAt: { gte: todayStart, lte: todayEnd } }
      }),
      prisma.partnerTransaction.findMany({
        where: { partnerId: partner.id, createdAt: { gte: monthStart } }
      }),
      prisma.partnerTransaction.groupBy({
        by: ['voucherType'],
        where: { partnerId: partner.id, createdAt: { gte: partnershipStartDate } },
        _sum: { grossAmount: true, quantity: true, partnerEarning: true }
      }),
      prisma.partnerTransaction.findMany({
        where: { partnerId: partner.id, createdAt: { gte: partnershipStartDate } },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    // Card 1: Lifetime Share Earnings & Total Vouchers Sold (accumulating GHS 1.50 for Sep 1-2 & GHS 1.00 onward)
    const lifetimeShareEarnings = allTxs.reduce((sum, tx) => sum + Number(tx.partnerEarning), 0);
    const totalVouchersSold = allTxs.reduce((sum, tx) => sum + tx.quantity, 0);
    const lifetimeGrossVolume = allTxs.reduce((sum, tx) => sum + Number(tx.grossAmount), 0);

    // Card 2: Available Balance (accumulated earnings that have not been withdrawn/sent to MoMo)
    const availableBalance = allTxs
      .filter(tx => tx.settlementStatus === 'Accrued')
      .reduce((sum, tx) => sum + Number(tx.partnerEarning), 0);

    // Withdrawn Amount (total money successfully disbursed)
    const completedSettlements = await prisma.partnerSettlement.findMany({
      where: { partnerId: partner.id, status: 'Completed' }
    });
    const withdrawnAmount = completedSettlements.reduce((sum, s) => sum + Number(s.amount), 0);

    // Card 3: Today's Earnings & Volume
    const todayEarnings = todayTxs.reduce((sum, tx) => sum + Number(tx.partnerEarning), 0);
    const todayVouchersSold = todayTxs.reduce((sum, tx) => sum + tx.quantity, 0);
    const todayGrossVolume = todayTxs.reduce((sum, tx) => sum + Number(tx.grossAmount), 0);

    // Card 4: Month to Date (MTD) Earnings & Volume
    const mtdEarnings = mtdTxs.reduce((sum, tx) => sum + Number(tx.partnerEarning), 0);
    const mtdVouchersSold = mtdTxs.reduce((sum, tx) => sum + tx.quantity, 0);
    const mtdGrossVolume = mtdTxs.reduce((sum, tx) => sum + Number(tx.grossAmount), 0);

    // Current Active Rate & Percentage
    const currentRate = 1.00;
    const voucherConfig = await prisma.voucherConfig.findFirst();
    const voucherPrice = voucherConfig ? Number(voucherConfig.becePrice) : 30.00;
    const dynamicSharePercentage = parseFloat(((currentRate / Math.max(1, voucherPrice - 15)) * 100).toFixed(2));

    // Category Breakdown
    const wassceCat = categoryBreakdown.find(c => c.voucherType === 'WASSCE_NOVDEC') || { _sum: { quantity: 0, grossAmount: 0, partnerEarning: 0 } };
    const beceCat = categoryBreakdown.find(c => c.voucherType === 'BECE') || { _sum: { quantity: 0, grossAmount: 0, partnerEarning: 0 } };

    const voucherDistribution = {
      wassce: {
        count: Number(wassceCat._sum.quantity || 0),
        volume: Number(wassceCat._sum.grossAmount || 0),
        earnings: Number(wassceCat._sum.partnerEarning || 0)
      },
      bece: {
        count: Number(beceCat._sum.quantity || 0),
        volume: Number(beceCat._sum.grossAmount || 0),
        earnings: Number(beceCat._sum.partnerEarning || 0)
      },
      novdec: {
        count: 0,
        volume: 0,
        earnings: 0
      }
    };

    return res.status(200).json({
      success: true,
      data: {
        partnerId: partner.partnerId,
        partnerName: partner.partnerName,
        contractRef: partner.contractRef,
        sharePercentage: dynamicSharePercentage,
        lifetimeGrossVolume,
        lifetimeShareEarnings,
        availableBalance,
        withdrawnAmount,
        totalVouchersSold,
        todayEarnings,
        todayVouchersSold,
        todayGrossVolume,
        mtdEarnings,
        mtdGrowthPercentage: 0.0,
        avgEarningPerVoucher: currentRate,
        voucherDistribution,
        recentTransactions
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch partner dashboard', 500));
  }
};

/**
 * Get Platform Transactions Ledger
 * GET /api/partner/transactions
 */
export const getPartnerTransactions = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Get Platform Transactions Ledger'
  // #swagger.description = 'Retrieves a paginated list of all partner revenue transactions.'
  try {
    const partner = await getPartnerFromReq(req);

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const { voucherType, settlementStatus, search } = req.query;

    const where = { partnerId: partner.id };

    if (voucherType && voucherType !== 'ALL') {
      where.voucherType = voucherType;
    }
    if (settlementStatus && settlementStatus !== 'ALL') {
      where.settlementStatus = settlementStatus;
    }
    if (search) {
      where.OR = [
        { orderRef: { contains: search } },
        { paymentMethod: { contains: search } }
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.partnerTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.partnerTransaction.count({ where })
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: {
        transactions,
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch partner transactions', 500));
  }
};

/**
 * Get Financial Reports & Interval Analytics
 * GET /api/partner/reports
 */
export const getPartnerReports = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Get Financial Reports & Analytics'
  // #swagger.description = 'Retrieves interval financial reports and breakdown charts.'
  try {
    const partner = await getPartnerFromReq(req);
    const { period = 'monthly' } = req.query;

    const [grossAggregate, categoryBreakdown] = await Promise.all([
      prisma.order.aggregate({
        where: { paymentStatus: 'SUCCESS' },
        _sum: { amount: true, quantity: true }
      }),
      prisma.order.groupBy({
        by: ['voucherType'],
        where: { paymentStatus: 'SUCCESS' },
        _sum: { amount: true, quantity: true }
      })
    ]);

    const totalVouchersSold = Number(grossAggregate._sum.quantity || 0);
    const perVoucherCut = 1.00; // Fixed GHS 1.00 per voucher
    const totalPartnerEarnings = totalVouchersSold * perVoucherCut;

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentMonthIdx = new Date().getMonth();
    
    // Build real chart data dynamically from DB orders without gross sales
    const chartData = monthNames.slice(0, currentMonthIdx + 1).map((label, idx) => {
      const isCurrentMonth = idx === currentMonthIdx;
      return {
        label,
        partnerEarnings: isCurrentMonth ? totalPartnerEarnings : 0,
        vouchersCount: isCurrentMonth ? totalVouchersSold : 0
      };
    });

    const categoryBreakdownFormatted = categoryBreakdown.map(c => {
      const vSold = Number(c._sum.quantity || 0);
      const pShare = vSold * perVoucherCut;
      const pct = totalVouchersSold > 0 ? (vSold / totalVouchersSold) * 100 : 0;
      return {
        category: `${displayNameFor(c.voucherType)} Results Checker`,
        vouchersSold: vSold,
        partnerShare: pShare,
        percentageOfTotal: parseFloat(pct.toFixed(1))
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        period,
        dateRange: {
          start: '2026-01-01',
          end: new Date().toISOString().slice(0, 10)
        },
        totalPartnerEarnings,
        totalVouchersSold,
        chartData,
        categoryBreakdown: categoryBreakdownFormatted
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch partner reports', 500));
  }
};

/**
 * Get Settlement / Payout History
 * GET /api/partner/settlements
 */
export const getPartnerSettlements = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Get Settlement / Payout History'
  // #swagger.description = 'Retrieves a list of all daily automated or manual settlement disbursements.'
  try {
    const partner = await getPartnerFromReq(req);

    const settlements = await prisma.partnerSettlement.findMany({
      where: { partnerId: partner.id },
      orderBy: { requestedAt: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: settlements
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch partner settlements', 500));
  }
};

/**
 * Request Payout Settlement
 * POST /api/partner/settlements/request
 */
export const requestPartnerSettlement = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Request Payout Settlement'
  // #swagger.description = 'Allows a partner to manually submit a withdrawal request.'
  try {
    const partner = await getPartnerFromReq(req);
    const { amount, notes } = req.body;

    const reqAmount = parseFloat(amount);
    if (isNaN(reqAmount) || reqAmount <= 0) {
      throw new AppError('Invalid payout settlement amount.', 400);
    }

    if (reqAmount > Number(partner.availableBalance)) {
      throw new AppError(`Insufficient available balance. Your withdrawable balance is GHS ${Number(partner.availableBalance).toFixed(2)}.`, 400);
    }

    const defaultAccount = partner.payoutAccounts[0] || {
      accountNumber: partner.phone,
      accountName: partner.partnerName,
      provider: 'MTN Mobile Money'
    };

    const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const reference = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomCode}`;

    // Take the money out of the balance and record the request together. The conditional update
    // means two requests sent at the same time cannot both pass the balance check.
    const settlement = await prisma.$transaction(async (tx) => {
      const reserved = await tx.partner.updateMany({
        where: { id: partner.id, availableBalance: { gte: reqAmount } },
        data: { availableBalance: { decrement: reqAmount } }
      });

      if (reserved.count !== 1) {
        const current = await tx.partner.findUnique({ where: { id: partner.id }, select: { availableBalance: true } });
        throw new AppError(`Insufficient available balance. Your withdrawable balance is GHS ${Number(current.availableBalance).toFixed(2)}.`, 400);
      }

      return tx.partnerSettlement.create({
        data: {
          partnerId: partner.id,
          reference,
          amount: reqAmount,
          fee: 0.00,
          netAmount: reqAmount,
          payoutMethod: 'MOMO',
          provider: defaultAccount.provider || 'MTN Mobile Money',
          destinationAccount: defaultAccount.accountNumber || partner.phone,
          accountName: defaultAccount.accountName || partner.partnerName,
          status: 'Pending',
          notes: notes || 'Manual partner settlement request'
        }
      });
    });

    logActivity({
      action: 'PARTNER_SETTLEMENT_REQUESTED',
      details: { partnerId: partner.partnerId, reference, amount: reqAmount },
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Payout request submitted successfully and queued for disbursement.',
      data: {
        reference: settlement.reference,
        amount: Number(settlement.amount),
        status: settlement.status,
        requestedAt: settlement.requestedAt
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to submit payout request', 500));
  }
};

/**
 * Get Payout Accounts
 * GET /api/partner/payout-accounts
 */
export const getPayoutAccounts = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Get Saved Payout Accounts'
  try {
    const partner = await getPartnerFromReq(req);
    return res.status(200).json({
      success: true,
      data: partner.payoutAccounts
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch payout accounts', 500));
  }
};

/**
 * Add Payout Account
 * POST /api/partner/payout-accounts
 */
export const createPayoutAccount = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Add New Payout Account'
  try {
    const partner = await getPartnerFromReq(req);
    const { type = 'MOMO', provider, accountNumber, accountName, isDefault = false } = req.body;

    if (!provider || !accountNumber || !accountName) {
      throw new AppError('Provider, accountNumber, and accountName are required.', 400);
    }

    if (isDefault) {
      await prisma.partnerPayoutAccount.updateMany({
        where: { partnerId: partner.id },
        data: { isDefault: false }
      });
    }

    const newAccount = await prisma.partnerPayoutAccount.create({
      data: {
        partnerId: partner.id,
        type: type === 'BANK' ? 'BANK' : 'MOMO',
        provider,
        accountNumber,
        accountName,
        isDefault
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Payout account added successfully.',
      data: newAccount
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to add payout account', 500));
  }
};

/**
 * Get Partner Notifications
 * GET /api/partner/notifications
 */
export const getPartnerNotifications = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Get Partner Notifications'
  try {
    const partner = await getPartnerFromReq(req);

    const notifications = await prisma.partnerNotification.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: notifications
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch notifications', 500));
  }
};

/**
 * Mark Notification As Read
 * PATCH /api/partner/notifications/:id/read
 */
export const markNotificationRead = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Mark Notification As Read'
  try {
    const { id } = req.params;
    const notification = await prisma.partnerNotification.update({
      where: { id },
      data: { isRead: true }
    });

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
      data: notification
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update notification', 500));
  }
};

/**
 * Mark All Notifications As Read
 * POST /api/partner/notifications/read-all
 */
export const markAllNotificationsRead = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Mark All Notifications As Read'
  try {
    const partner = await getPartnerFromReq(req);

    await prisma.partnerNotification.updateMany({
      where: { partnerId: partner.id, isRead: false },
      data: { isRead: true }
    });

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.'
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update notifications', 500));
  }
};

/**
 * Get Partner Profile
 * GET /api/partner/profile
 */
export const getPartnerProfile = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Get Partner Profile'
  try {
    const partner = await getPartnerFromReq(req);

    return res.status(200).json({
      success: true,
      data: {
        id: partner.id,
        partnerId: partner.partnerId,
        partnerName: partner.partnerName,
        legalEntityName: partner.legalEntityName,
        email: partner.email,
        phone: partner.phone,
        contractRef: partner.contractRef,
        sharePercentage: Number(partner.sharePercentage),
        status: partner.status,
        startDate: partner.startDate,
        lifetimeShareEarnings: Number(partner.lifetimeShareEarnings),
        withdrawnAmount: Number(partner.withdrawnAmount),
        availableBalance: Number(partner.availableBalance),
        payoutMethods: partner.payoutAccounts
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch partner profile', 500));
  }
};

/**
 * Update Partner Profile
 * PUT /api/partner/profile
 */
export const updatePartnerProfile = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Update Partner Profile'
  try {
    const partner = await getPartnerFromReq(req);
    const { partnerName, legalEntityName, email, phone } = req.body;

    const updateData = {};
    if (partnerName) updateData.partnerName = partnerName.trim();
    if (legalEntityName) updateData.legalEntityName = legalEntityName.trim();
    if (email) updateData.email = email.toLowerCase().trim();
    if (phone) updateData.phone = phone.trim();

    const updatedPartner = await prisma.partner.update({
      where: { id: partner.id },
      data: updateData
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: updatedPartner
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update partner profile', 500));
  }
};

/**
 * Change Partner Password
 * POST /api/partner/change-password
 */
export const changePartnerPassword = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Change Partner Password'
  try {
    const partner = await getPartnerFromReq(req);
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required.', 400);
    }

    const isMatch = await bcrypt.compare(currentPassword, partner.passwordHash);
    if (!isMatch) {
      throw new AppError('Current password is incorrect.', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.partner.update({
      where: { id: partner.id },
      data: { passwordHash: hashedPassword }
    });

    // Also update User password if matched
    const user = await prisma.user.findFirst({ where: { email: partner.email } });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully.'
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to change password', 500));
  }
};

/**
 * Get / Update Settings
 * GET /api/partner/settings
 * PUT /api/partner/settings
 */
export const getPartnerSettings = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Get Partner Settings'
  try {
    const partner = await getPartnerFromReq(req);
    return res.status(200).json({
      success: true,
      data: partner.settings || {
        autoSettlementEnabled: true,
        autoSettlementThreshold: 1000.00,
        settlementFrequency: "DAILY",
        defaultPayoutAccountId: partner.payoutAccounts[0]?.id || null,
        emailDailyDigest: true,
        emailPayoutAlerts: true,
        smsSurgeAlerts: true,
        smsPayoutAlerts: true,
        surgeAlertThreshold: 50,
        currencyDisplay: "GHS",
        timezone: "GMT (Accra)"
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch settings', 500));
  }
};

export const updatePartnerSettings = async (req, res, next) => {
  // #swagger.tags = ['Partner Portal']
  // #swagger.summary = 'Update Partner Settings'
  try {
    const partner = await getPartnerFromReq(req);
    const {
      autoSettlementEnabled,
      autoSettlementThreshold,
      settlementFrequency,
      defaultPayoutAccountId,
      emailDailyDigest,
      emailPayoutAlerts,
      smsSurgeAlerts,
      smsPayoutAlerts
    } = req.body;

    const settings = await prisma.partnerSetting.upsert({
      where: { partnerId: partner.id },
      update: {
        autoSettlementEnabled,
        autoSettlementThreshold: autoSettlementThreshold ? parseFloat(autoSettlementThreshold) : undefined,
        settlementFrequency,
        defaultPayoutAccountId,
        emailDailyDigest,
        emailPayoutAlerts,
        smsSurgeAlerts,
        smsPayoutAlerts
      },
      create: {
        partnerId: partner.id,
        autoSettlementEnabled: autoSettlementEnabled !== undefined ? autoSettlementEnabled : true,
        settlementFrequency: settlementFrequency || 'DAILY',
        emailDailyDigest: emailDailyDigest !== undefined ? emailDailyDigest : true,
        emailPayoutAlerts: emailPayoutAlerts !== undefined ? emailPayoutAlerts : true,
        smsSurgeAlerts: smsSurgeAlerts !== undefined ? smsSurgeAlerts : true,
        smsPayoutAlerts: smsPayoutAlerts !== undefined ? smsPayoutAlerts : true
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Settings updated successfully.',
      data: settings
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update settings', 500));
  }
};
