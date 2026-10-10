import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { getAffiliateBalance, payoutHoldRemainingMs, PAYOUT_DETAILS_HOLD_MS } from '../../utils/affiliate/affiliateBalance.js';
import { verifyAccountPassword } from '../../utils/auth/stepUp.js';
import { sendSMS } from '../../utils/sms/smsHelper.js';

/**
 * Get affiliate dashboard metrics and active status.
 */
export const getAffiliateDashboard = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Portal']
  // #swagger.summary = 'Get Affiliate Dashboard Metrics'
  // #swagger.description = 'Retrieves live dashboard statistics for the logged-in affiliate: total vouchers sold, lifetime sales value, approved commission, total withdrawn amount, pending withdrawals, and available withdrawable balance.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const userId = req.user.id;

    const profile = await prisma.affiliateProfile.findUnique({
      where: { userId }
    });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    // Sum approved commissions
    // Shared calculation: withdrawals being processed count as already spoken for
    const balance = await getAffiliateBalance(profile.id);
    const approvedCommission = balance.totalEarned;
    const withdrawnAmount = balance.withdrawn;
    const pendingWithdrawalAmount = balance.pending;

    // Fetch recent successful orders tracked under this affiliate channel (latest 5)
    const recentOrders = await prisma.order.findMany({
      where: {
        affiliateId: profile.id,
        paymentStatus: 'SUCCESS'
      },
      include: {
        commission: {
          select: {
            amount: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    return res.status(200).json({
      success: true,
      data: {
        affiliateCode: profile.affiliateCode,
        businessName: profile.businessName,
        ussdCode: profile.ussdCode || 'Not assigned',
        status: profile.status,
        totalVouchersSold: profile.totalVouchersSold,
        approvedCommission,
        withdrawnAmount,
        pendingWithdrawalAmount,
        availableBalance,
        recentOrders
      }
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch affiliate dashboard', 500));
  }
};

/**
 * Get sales tracked via affiliate USSD code.
 */
export const getAffiliateSales = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Portal']
  // #swagger.summary = 'Get Affiliate Sales History'
  // #swagger.description = 'Retrieves a list of successful voucher orders generated through the affiliate USSD extension.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const userId = req.user.id;
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const [sales, total] = await Promise.all([
      prisma.order.findMany({
        where: {
          affiliateId: profile.id,
          paymentStatus: 'SUCCESS'
        },
        include: { commission: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.order.count({
        where: {
          affiliateId: profile.id,
          paymentStatus: 'SUCCESS'
        }
      })
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      data: sales
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch affiliate sales', 500));
  }
};

/**
 * Get detailed commission earnings history.
 */
export const getAffiliateEarnings = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Portal']
  // #swagger.summary = 'Get Affiliate Earnings History'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const userId = req.user.id;
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    const commissions = await prisma.affiliateCommission.findMany({
      where: { affiliateId: profile.id },
      include: { order: true },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: commissions
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch affiliate earnings', 500));
  }
};

/**
 * Get affiliate withdrawal requests.
 */
export const getAffiliateWithdrawals = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Portal']
  // #swagger.summary = 'Get Affiliate Withdrawal Requests'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const userId = req.user.id;
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    const withdrawals = await prisma.withdrawalRequest.findMany({
      where: { affiliateId: profile.id },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: withdrawals
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch withdrawal requests', 500));
  }
};

/**
 * Submit a new withdrawal request.
 */
export const requestWithdrawal = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Portal']
  // #swagger.summary = 'Request Commission Withdrawal'
  // #swagger.description = 'Submits a request to withdraw available approved earnings. Enforces minimum withdrawal limits and admin-configured daily withdrawal caps.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["amount"],
              properties: {
                amount: { type: "number", example: 150.00 }
              }
            }
          }
        }
     }
  */
  try {
    const userId = req.user.id;
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    if (profile.status !== 'APPROVED') {
      throw new AppError('Only approved active affiliates can request withdrawals.', 403);
    }

    const withdrawAmount = parseFloat(req.body.amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      throw new AppError('Withdrawal amount must be a positive number.', 400);
    }

    // Fetch Affiliate Config for min limit & daily cap
    const config = await prisma.affiliateConfig.findFirst();
    const minLimit = config ? Number(config.minWithdrawalAmount) : 10.00;
    const dailyCap = config ? Number(config.dailyWithdrawalCap) : 1000.00;

    if (withdrawAmount < minLimit) {
      throw new AppError(`Minimum withdrawal amount is GHS ${minLimit.toFixed(2)}.`, 400);
    }

    // Withdrawals are held briefly after payout details change
    const holdRemainingMs = payoutHoldRemainingMs(profile);
    if (holdRemainingMs > 0) {
      const hours = Math.ceil(holdRemainingMs / (60 * 60 * 1000));
      throw new AppError(`Withdrawals are on hold for ${hours} more hour(s) because your payout details were changed recently. This protects your earnings.`, 403);
    }

    // Snapshot account details based on payout method
    let accountDetailsObj = {};
    if (profile.payoutMethod === 'MOBILE_MONEY') {
      accountDetailsObj = {
        method: 'MOBILE_MONEY',
        network: profile.momoNetwork,
        number: profile.momoNumber,
        accountName: profile.momoAccountName
      };
    } else {
      accountDetailsObj = {
        method: 'BANK_ACCOUNT',
        bankName: profile.bankName,
        accountNumber: profile.bankAccountNumber,
        accountName: profile.bankAccountName
      };
    }

    // Check the balance and create the request in one transaction, with the profile row locked,
    // so two requests sent at the same time cannot both pass the balance check.
    const withdrawal = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM AffiliateProfile WHERE id = ${profile.id} FOR UPDATE`;

      const balance = await getAffiliateBalance(profile.id, tx);

      if (withdrawAmount > balance.available) {
        throw new AppError(`Insufficient available balance. Your withdrawable balance is GHS ${balance.available.toFixed(2)}.`, 400);
      }

      // Enforce Daily Withdrawal Cap
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const todayWithdrawalsAggregate = await tx.withdrawalRequest.aggregate({
        where: {
          affiliateId: profile.id,
          status: { in: ['PENDING', 'PROCESSING', 'APPROVED'] },
          createdAt: { gte: startOfDay }
        },
        _sum: { amount: true }
      });
      const todayWithdrawnTotal = Number(todayWithdrawalsAggregate._sum.amount || 0);

      if (todayWithdrawnTotal + withdrawAmount > dailyCap) {
        const remainingDailyCap = Math.max(0, dailyCap - todayWithdrawnTotal);
        throw new AppError(`Withdrawal exceeds your daily cap of GHS ${dailyCap.toFixed(2)}. Remaining daily limit: GHS ${remainingDailyCap.toFixed(2)}.`, 400);
      }

      return tx.withdrawalRequest.create({
        data: {
          affiliateId: profile.id,
          amount: withdrawAmount,
          payoutMethod: profile.payoutMethod,
          accountDetails: JSON.stringify(accountDetailsObj),
          status: 'PENDING'
        }
      });
    }, {
      // Simultaneous requests queue on the profile row lock; wait rather than fail
      maxWait: 15000,
      timeout: 20000
    });

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_WITHDRAWAL_REQUESTED',
      details: { withdrawalId: withdrawal.id, amount: withdrawAmount, payoutMethod: profile.payoutMethod },
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully. Awaiting admin approval.',
      data: withdrawal
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to submit withdrawal request.', 500));
  }
};

/**
 * Get affiliate profile details.
 */
export const getAffiliateProfile = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Portal']
  // #swagger.summary = 'Get Affiliate Profile'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        createdAt: true,
        affiliateProfile: true
      }
    });

    return res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch affiliate profile', 500));
  }
};

/**
 * Update payout account details.
 */
export const updatePaymentDetails = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Portal']
  // #swagger.summary = 'Update Payout Details'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const userId = req.user.id;
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    const {
      payoutMethod,
      momoNetwork,
      momoNumber,
      momoAccountName,
      bankName,
      bankAccountNumber,
      bankAccountName
    } = req.body;

    // Whoever gets into the account must also know the password to redirect the money
    await verifyAccountPassword(userId, req.body.currentPassword);

    const updateData = { payoutDetailsUpdatedAt: new Date() };

    if (payoutMethod && ['MOBILE_MONEY', 'BANK_ACCOUNT'].includes(payoutMethod)) {
      updateData.payoutMethod = payoutMethod;
    }

    if (momoNetwork !== undefined) updateData.momoNetwork = momoNetwork ? momoNetwork.trim() : null;
    if (momoNumber !== undefined) updateData.momoNumber = momoNumber ? momoNumber.trim() : null;
    if (momoAccountName !== undefined) updateData.momoAccountName = momoAccountName ? momoAccountName.trim() : null;

    if (bankName !== undefined) updateData.bankName = bankName ? bankName.trim() : null;
    if (bankAccountNumber !== undefined) updateData.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : null;
    if (bankAccountName !== undefined) updateData.bankAccountName = bankAccountName ? bankAccountName.trim() : null;

    const updatedProfile = await prisma.affiliateProfile.update({
      where: { id: profile.id },
      data: updateData
    });

    // Warn the owner on the number we had on file, so an unwanted change is noticed
    const previousNumber = profile.momoNumber || req.user.phoneNumber;
    if (previousNumber) {
      sendSMS({
        to: previousNumber,
        message: 'CivicTree: Your affiliate payout details were just changed and withdrawals are on hold for 48 hours. If this was not you, contact CivicTree support immediately.'
      }).catch((err) => console.error('[AFFILIATE] Failed to send payout change notice:', err.message));
    }

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_PAYMENT_DETAILS_UPDATED',
      details: { affiliateId: profile.id, updatedFields: Object.keys(updateData) },
      req
    });

    const holdHours = Math.round(PAYOUT_DETAILS_HOLD_MS / (60 * 60 * 1000));
    return res.status(200).json({
      success: true,
      message: `Payout details updated successfully. For your security, withdrawals are on hold for ${holdHours} hours.`,
      data: updatedProfile
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update payment details.', 500));
  }
};

/**
 * Update general affiliate profile personal information.
 */
export const updateAffiliateProfile = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Portal']
  // #swagger.summary = 'Update Affiliate Personal Profile'
  // #swagger.description = 'Updates personal information (fullName, businessName, location, phoneNumber, email) for the logged-in affiliate.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const userId = req.user.id;
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    const { fullName, businessName, location, phoneNumber, email } = req.body;

    const userUpdateData = {};
    const profileUpdateData = {};

    if (fullName !== undefined) userUpdateData.fullName = fullName.trim();
    if (phoneNumber !== undefined) userUpdateData.phoneNumber = phoneNumber.trim();
    if (email !== undefined) userUpdateData.email = email.toLowerCase().trim();

    // Changing the sign-in email or phone number can take over the account, so confirm the password
    const changesLoginDetails =
      (userUpdateData.email && userUpdateData.email !== req.user.email) ||
      (userUpdateData.phoneNumber && userUpdateData.phoneNumber !== req.user.phoneNumber);

    if (changesLoginDetails) {
      await verifyAccountPassword(userId, req.body.currentPassword);
    }

    if (businessName !== undefined) profileUpdateData.businessName = businessName ? businessName.trim() : null;
    if (location !== undefined) profileUpdateData.location = location ? location.trim() : null;

    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: userUpdateData
      });
    }

    let updatedProfile = profile;
    if (Object.keys(profileUpdateData).length > 0) {
      updatedProfile = await prisma.affiliateProfile.update({
        where: { id: profile.id },
        data: profileUpdateData
      });
    }

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_PROFILE_UPDATED',
      details: { affiliateId: profile.id, userFields: Object.keys(userUpdateData), profileFields: Object.keys(profileUpdateData) },
      req
    });

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        createdAt: true,
        affiliateProfile: true
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Profile information updated successfully.',
      data: updatedUser
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update affiliate profile.', 500));
  }
};

