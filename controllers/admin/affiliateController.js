import bcrypt from 'bcryptjs';
import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { VOUCHER_TYPES, commissionFieldFor, defaultCommissionFor } from '../../utils/voucher/voucherTypes.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { getAffiliateBalance } from '../../utils/affiliate/affiliateBalance.js';
import { sendHubtelPayout } from '../../utils/payment/hubtelHelper.js';
import { verifyStepUp, requireTwoFactorIfEnabled } from '../../utils/auth/stepUp.js';
import { referenceFor } from '../../utils/payment/payoutReconciler.js';
import { notifyAffiliateStatusChange } from '../../utils/notification/affiliateNotificationHelper.js';
import { generateNextAffiliateCode } from '../../utils/affiliate/affiliateCodeGenerator.js';

/**
 * List all affiliates for admin management with filters and search.
 */
export const getAdminAffiliates = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'List All Affiliates'
  // #swagger.description = 'Retrieves a list of all affiliate applications and profiles with filtering by status (PENDING, APPROVED, REJECTED, SUSPENDED, DEACTIVATED) and text search.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { status, search, page: reqPage, limit: reqLimit } = req.query;
    const page = parseInt(reqPage, 10) || 1;
    const limit = parseInt(reqLimit, 10) || 20;
    const skip = (page - 1) * limit;

    const where = {
      user: {
        id: { not: '' }
      }
    };

    if (status) {
      const normalizedStatus = status.toUpperCase();
      if (['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'].includes(normalizedStatus)) {
        where.status = normalizedStatus;
      }
    }

    if (search) {
      const q = search.trim();
      where.AND = [
        {
          OR: [
            { affiliateCode: { contains: q } },
            { ussdCode: { contains: q } },
            { businessName: { contains: q } },
            { user: { fullName: { contains: q } } },
            { user: { email: { contains: q } } },
            { user: { phoneNumber: { contains: q } } }
          ]
        }
      ];
    }

    const [affiliates, total] = await Promise.all([
      prisma.affiliateProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phoneNumber: true,
              isActive: true,
              createdAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.affiliateProfile.count({ where })
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      data: affiliates
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch affiliates', 500));
  }
};

/**
 * Admin directly creates a new affiliate.
 */
export const createAffiliateAdmin = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Admin Create Affiliate'
  // #swagger.description = 'Directly registers and creates an affiliate profile with assigned status and optional USSD code.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const {
      fullName,
      businessName,
      phoneNumber,
      email,
      location,
      password,
      status,
      ussdCode,
      payoutMethod,
      momoNetwork,
      momoNumber,
      momoAccountName,
      bankName,
      bankAccountNumber,
      bankAccountName
    } = req.body;

    if (!fullName || !phoneNumber || !email || !password) {
      throw new AppError('Full name, phone number, email, and password are required.', 400);
    }

    // Check existing email or phone
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase().trim() },
          { phoneNumber: phoneNumber.trim() }
        ]
      }
    });

    if (existingUser) {
      throw new AppError('User with this email or phone number already exists.', 400);
    }

    // Check USSD uniqueness if provided
    if (ussdCode) {
      const formattedUssd = ussdCode.trim();
      const existingUssd = await prisma.affiliateProfile.findFirst({
        where: { ussdCode: formattedUssd },
        select: { id: true, userId: true, affiliateCode: true }
      });
      if (existingUssd) {
        const user = await prisma.user.findUnique({
          where: { id: existingUssd.userId },
          select: { id: true, fullName: true, email: true }
        });
        if (!user) {
          // Orphaned profile from a deleted user; clean it up to free the USSD code
          await prisma.affiliateProfile.delete({ where: { id: existingUssd.id } }).catch(() => {});
        } else {
          throw new AppError(`USSD code ${formattedUssd} is already assigned to another affiliate.`, 400);
        }
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const initialStatus = status && ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'].includes(status.toUpperCase())
      ? status.toUpperCase()
      : 'APPROVED';

    const result = await prisma.$transaction(async (tx) => {
      // Generate safe unique affiliate code (e.g. AFF-1001)
      const affiliateCode = await generateNextAffiliateCode(tx);

      const user = await tx.user.create({
        data: {
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim(),
          email: email.toLowerCase().trim(),
          role: 'AFFILIATE',
          password: hashedPassword,
          firstTimeLogin: false,
          isActive: true
        }
      });

      const profile = await tx.affiliateProfile.create({
        data: {
          userId: user.id,
          affiliateCode,
          businessName: businessName ? businessName.trim() : null,
          location: location ? location.trim() : null,
          status: initialStatus,
          ussdCode: ussdCode ? ussdCode.trim() : null,
          payoutMethod: payoutMethod || 'MOBILE_MONEY',
          momoNetwork: momoNetwork ? momoNetwork.trim() : null,
          momoNumber: momoNumber ? momoNumber.trim() : null,
          momoAccountName: momoAccountName ? momoAccountName.trim() : null,
          bankName: bankName ? bankName.trim() : null,
          bankAccountNumber: bankAccountNumber ? bankAccountNumber.trim() : null,
          bankAccountName: bankAccountName ? bankAccountName.trim() : null
        }
      });

      return { user, profile };
    });

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_CREATED_BY_ADMIN',
      details: { affiliateCode: result.profile.affiliateCode, email: result.user.email, status: initialStatus, ussdCode },
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Affiliate created successfully by admin.',
      data: result.profile
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to create affiliate.', 500));
  }
};

/**
 * Get detailed profile and metrics for a specific affiliate.
 */
export const getAdminAffiliateById = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Get Affiliate Profile Details'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { id } = req.params;

    const profile = await prisma.affiliateProfile.findFirst({
      where: {
        id,
        user: { id: { not: '' } }
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            isActive: true,
            createdAt: true
          }
        },
        commissions: {
          take: 20,
          orderBy: { createdAt: 'desc' }
        },
        withdrawals: {
          take: 20,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    // Aggregates
    // Shared calculation: withdrawals being processed count as already spoken for
    const balance = await getAffiliateBalance(profile.id);
    const approvedCommission = balance.totalEarned;
    const withdrawnAmount = balance.withdrawn;
    const pendingWithdrawalAmount = balance.pending;
    const availableBalance = balance.available;

    return res.status(200).json({
      success: true,
      data: {
        ...profile,
        metrics: {
          totalVouchersSold: profile.totalVouchersSold,
          totalSalesGenerated: Number(profile.totalSalesGenerated),
          approvedCommission,
          withdrawnAmount,
          pendingWithdrawalAmount,
          availableBalance
        }
      }
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch affiliate details', 500));
  }
};

/**
 * Update affiliate status (Approve, Reject, Suspend, Deactivate).
 */
export const updateAffiliateStatus = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Update Affiliate Status'
  // #swagger.description = 'Updates affiliate account status (APPROVED, REJECTED, SUSPENDED, DEACTIVATED). Allows setting/updating USSD code upon approval, or providing a rejection reason.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status"],
              properties: {
                status: { type: "string", example: "APPROVED", enum: ["APPROVED", "REJECTED", "SUSPENDED", "DEACTIVATED"] },
                ussdCode: { type: "string", example: "*713*001#" },
                rejectionReason: { type: "string", example: "Incomplete documentation provided." }
              }
            }
          }
        }
     }
  */
  try {
    const { id } = req.params;
    const { status, ussdCode, rejectionReason } = req.body;

    if (!status) {
      throw new AppError('Status is required.', 400);
    }

    const normalizedStatus = status.toUpperCase();
    if (!['APPROVED', 'REJECTED', 'SUSPENDED', 'DEACTIVATED', 'PENDING'].includes(normalizedStatus)) {
      throw new AppError('Invalid status value.', 400);
    }

    const profile = await prisma.affiliateProfile.findFirst({
      where: {
        id,
        user: { id: { not: '' } }
      }
    });

    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    const updateData = { status: normalizedStatus };

    if (normalizedStatus === 'REJECTED') {
      if (!rejectionReason) {
        throw new AppError('Rejection reason is required when rejecting an affiliate application.', 400);
      }
      updateData.rejectionReason = rejectionReason.trim();
    } else {
      updateData.rejectionReason = null;
    }

    if (ussdCode !== undefined && ussdCode !== null) {
      const formattedUssd = ussdCode.trim();
      if (formattedUssd) {
        // Check uniqueness if changed
        const existingUssd = await prisma.affiliateProfile.findFirst({
          where: { ussdCode: formattedUssd, NOT: { id: profile.id } },
          select: { id: true, userId: true, affiliateCode: true }
        });
        if (existingUssd) {
          const user = await prisma.user.findUnique({
            where: { id: existingUssd.userId },
            select: { id: true, fullName: true, email: true }
          });
          if (!user) {
            // Clean up orphaned profile to free the USSD code
            await prisma.affiliateProfile.delete({ where: { id: existingUssd.id } }).catch(() => {});
          } else {
            throw new AppError(`USSD code ${formattedUssd} is already assigned to another affiliate.`, 400);
          }
        }
        updateData.ussdCode = formattedUssd;
      }
    }

    const updatedProfile = await prisma.affiliateProfile.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phoneNumber: true
          }
        }
      }
    });

    // Send SMS & Email notification to affiliate on status change
    notifyAffiliateStatusChange({
      user: updatedProfile.user,
      profile: updatedProfile,
      status: normalizedStatus,
      rejectionReason: updatedProfile.rejectionReason
    });

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_STATUS_UPDATED',
      details: { affiliateId: id, oldStatus: profile.status, newStatus: normalizedStatus, ussdCode: updatedProfile.ussdCode },
      req
    });

    return res.status(200).json({
      success: true,
      message: `Affiliate status updated to ${normalizedStatus}.`,
      data: updatedProfile
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update affiliate status.', 500));
  }
};

/**
 * Edit / Update assigned dynamic USSD extension code.
 */
export const updateAffiliateUssd = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Update Affiliate USSD Extension Code'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["ussdCode"],
              properties: {
                ussdCode: { type: "string", example: "*713*001#" }
              }
            }
          }
        }
     }
  */
  try {
    const { id } = req.params;
    const { ussdCode } = req.body;

    if (!ussdCode || !ussdCode.trim()) {
      throw new AppError('USSD code is required.', 400);
    }

    const formattedUssd = ussdCode.trim();

    const profile = await prisma.affiliateProfile.findFirst({
      where: {
        id,
        user: { id: { not: '' } }
      }
    });
    if (!profile) {
      throw new AppError('Affiliate profile not found.', 404);
    }

    const existingUssd = await prisma.affiliateProfile.findFirst({
      where: { ussdCode: formattedUssd, NOT: { id } },
      select: { id: true, userId: true, affiliateCode: true }
    });

    if (existingUssd) {
      const user = await prisma.user.findUnique({
        where: { id: existingUssd.userId },
        select: { id: true, fullName: true, email: true }
      });
      if (!user) {
        // Clean up orphaned profile to free the USSD code
        await prisma.affiliateProfile.delete({ where: { id: existingUssd.id } }).catch(() => {});
      } else {
        throw new AppError(`USSD code ${formattedUssd} is already assigned to another affiliate.`, 400);
      }
    }

    const updatedProfile = await prisma.affiliateProfile.update({
      where: { id },
      data: { ussdCode: formattedUssd }
    });

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_USSD_UPDATED',
      details: { affiliateId: id, oldUssd: profile.ussdCode, newUssd: formattedUssd },
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Affiliate USSD code updated successfully.',
      data: updatedProfile
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update affiliate USSD code.', 500));
  }
};

/**
 * List withdrawal requests for admin review.
 */
export const getAdminWithdrawalRequests = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'List All Withdrawal Requests'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { status, page: reqPage, limit: reqLimit } = req.query;
    const page = parseInt(reqPage, 10) || 1;
    const limit = parseInt(reqLimit, 10) || 20;
    const skip = (page - 1) * limit;

    const where = {
      affiliate: {
        user: { id: { not: '' } }
      }
    };
    if (status) {
      const normalizedStatus = status.toUpperCase();
      if (['PENDING', 'APPROVED', 'REJECTED'].includes(normalizedStatus)) {
        where.status = normalizedStatus;
      }
    }

    const [requests, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        include: {
          affiliate: {
            include: {
              user: {
                select: {
                  fullName: true,
                  email: true,
                  phoneNumber: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.withdrawalRequest.count({ where })
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      data: requests
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch withdrawal requests', 500));
  }
};

/**
 * Process a withdrawal request (Approve or Reject).
 */
export const processWithdrawalRequest = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Approve or Reject Withdrawal Request'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status"],
              properties: {
                status: { type: "string", example: "APPROVED", enum: ["APPROVED", "REJECTED"] },
                adminNote: { type: "string", example: "Paid via MoMo transaction ID 987654321." }
              }
            }
          }
        }
     }
  */
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;

    if (!status || !['APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
      throw new AppError('Status must be APPROVED or REJECTED.', 400);
    }

    const normalizedStatus = status.toUpperCase();

    const request = await prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { affiliate: true }
    });

    if (!request) {
      throw new AppError('Withdrawal request not found.', 404);
    }

    if (request.status !== 'PENDING') {
      throw new AppError(`Withdrawal request has already been ${request.status.toLowerCase()}.`, 400);
    }

    // Approving sends real money, so admins with two-factor sign-in must confirm with a
    // current code. Checked before the claim below, so a missing code leaves the request
    // untouched in the queue rather than stuck as PROCESSING.
    if (normalizedStatus === 'APPROVED') {
      await requireTwoFactorIfEnabled(req.user.id, req.body.twoFactorCode);
    }

    // Claim the request before sending any money. A second click (or a second admin) matches
    // nothing here and stops, so a payout can never be sent twice.
    const claimed = await prisma.withdrawalRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: normalizedStatus === 'APPROVED' ? 'PROCESSING' : 'REJECTED' }
    });

    if (claimed.count !== 1) {
      throw new AppError('This withdrawal request is already being processed.', 409);
    }

    let payoutResult = null;
    if (normalizedStatus === 'APPROVED') {
      let accDetails = {};
      try {
        accDetails = typeof request.accountDetails === 'string' ? JSON.parse(request.accountDetails) : request.accountDetails;
      } catch (e) {
        accDetails = {};
      }

      const recipientNumber = accDetails.number || accDetails.accountNumber || request.affiliate.momoNumber || request.affiliate.bankAccountNumber;
      const recipientName = accDetails.accountName || request.affiliate.momoAccountName || request.affiliate.bankAccountName;
      const channel = accDetails.network || accDetails.bankName || request.affiliate.momoNetwork || request.affiliate.bankName;

      if (!recipientNumber || !recipientName || !channel) {
        await prisma.withdrawalRequest.update({
          where: { id },
          data: { status: 'PENDING' } // nothing was sent; put it back in the queue
        });
        throw new AppError('Affiliate payment account details are incomplete. Cannot process payout transfer.', 400);
      }

      try {
        payoutResult = await sendHubtelPayout({
          recipientName,
          recipientNumber,
          amount: Number(request.amount),
          payoutMethod: request.payoutMethod,
          channel,
          clientReference: referenceFor(request.id),
          description: `Affiliate Commission Payout - ${request.affiliate.affiliateCode}`
        });
      } catch (payoutErr) {
        console.error(`[AFFILIATE PAYOUT ERROR] Hubtel transfer failed for withdrawal ${id}:`, payoutErr.message);

        // Park it as FAILED rather than PENDING: Hubtel may still have accepted the transfer,
        // so an admin must check with Hubtel before anyone retries it.
        await prisma.withdrawalRequest.update({
          where: { id },
          data: {
            status: 'FAILED',
            adminNote: `Payout failed: ${payoutErr.message}`,
            processedAt: new Date()
          }
        });

        logActivity({
          userId: req.user.id,
          action: 'AFFILIATE_WITHDRAWAL_PAYOUT_FAILED',
          details: { withdrawalId: id, affiliateId: request.affiliateId, amount: Number(request.amount), error: payoutErr.message },
          req
        });

        throw new AppError(`Hubtel payout transfer failed: ${payoutErr.message}. The request is marked FAILED — confirm with Hubtel before retrying.`, 400);
      }
    }

    // A payout Hubtel accepted but has not finished (code 0001) stays PROCESSING until the
    // payout callback or the reconciliation job confirms it.
    const awaitingConfirmation = normalizedStatus === 'APPROVED' && payoutResult?.pending;
    const finalStatus = awaitingConfirmation ? 'PROCESSING' : normalizedStatus;

    // Keep the Hubtel reference on the record so a payout can be traced later
    const payoutReference = payoutResult?.transactionId ? ` [Hubtel transaction: ${payoutResult.transactionId}]` : '';
    const updatedRequest = await prisma.withdrawalRequest.update({
      where: { id },
      data: {
        status: finalStatus,
        adminNote: `${adminNote ? adminNote.trim() : (payoutResult?.message || '')}${payoutReference}`.trim() || null,
        processedAt: awaitingConfirmation ? null : new Date()
      }
    });

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_WITHDRAWAL_PROCESSED',
      details: { withdrawalId: id, affiliateId: request.affiliateId, amount: Number(request.amount), status: finalStatus },
      req
    });

    return res.status(200).json({
      success: true,
      message: awaitingConfirmation
        ? 'Payout sent to Hubtel. It will show as approved once Hubtel confirms the transfer.'
        : `Withdrawal request ${normalizedStatus.toLowerCase()} successfully.`,
      data: updatedRequest
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to process withdrawal request.', 500));
  }
};

/**
 * Get current affiliate commission & withdrawal settings.
 */
export const getAffiliateConfig = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Get Affiliate System Settings'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    let config = await prisma.affiliateConfig.findFirst();
    if (!config) {
      config = await prisma.affiliateConfig.create({
        data: {
          ...Object.fromEntries(
            VOUCHER_TYPES.map((type) => [commissionFieldFor(type), defaultCommissionFor(type)])
          ),
          minWithdrawalAmount: 10.00,
          dailyWithdrawalCap: 1000.00
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch affiliate configurations', 500));
  }
};

/**
 * Update affiliate system commission & withdrawal settings.
 */
export const updateAffiliateConfig = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Update Affiliate System Settings'
  // #swagger.description = 'Updates commission rates per voucher type sold, minimum withdrawal request amounts, and daily withdrawal caps per affiliate.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                wassceNovdecCommission: { type: "number", example: 2.50 },
                beceCommission: { type: "number", example: 1.75 },
                minWithdrawalAmount: { type: "number", example: 10.00 },
                dailyWithdrawalCap: { type: "number", example: 2000.00 }
              }
            }
          }
        }
     }
  */
  try {
    const { minWithdrawalAmount, dailyWithdrawalCap } = req.body;

    let existing = await prisma.affiliateConfig.findFirst();

    const updateData = {};
    // One commission rate per voucher type we sell
    for (const type of VOUCHER_TYPES) {
      const field = commissionFieldFor(type);
      if (req.body[field] !== undefined) updateData[field] = parseFloat(req.body[field]);
    }
    if (minWithdrawalAmount !== undefined) updateData.minWithdrawalAmount = parseFloat(minWithdrawalAmount);
    if (dailyWithdrawalCap !== undefined) updateData.dailyWithdrawalCap = parseFloat(dailyWithdrawalCap);

    let config;
    if (existing) {
      config = await prisma.affiliateConfig.update({
        where: { id: existing.id },
        data: updateData
      });
    } else {
      config = await prisma.affiliateConfig.create({
        data: {
          ...Object.fromEntries(
            VOUCHER_TYPES.map((type) => [
              commissionFieldFor(type),
              updateData[commissionFieldFor(type)] ?? defaultCommissionFor(type)
            ])
          ),
          minWithdrawalAmount: updateData.minWithdrawalAmount || 10.00,
          dailyWithdrawalCap: updateData.dailyWithdrawalCap || 1000.00
        }
      });
    }

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_CONFIG_UPDATED',
      details: updateData,
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Affiliate system configurations updated successfully.',
      data: config
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update affiliate configuration.', 500));
  }
};

/**
 * Direct Admin Money Withdrawal Endpoint.
 * Allows administrators to withdraw money dynamically to Mobile Money or Bank Accounts with strict validation.
 */
export const processAdminDirectWithdrawal = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Admin Direct Money Withdrawal'
  // #swagger.description = 'Executes an immediate money withdrawal transfer for an administrator to a dynamic Mobile Money account or Bank Account with strict payload validation.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["amount", "payoutMethod"],
              properties: {
                amount: { type: "number", example: 500.00 },
                payoutMethod: { type: "string", example: "MOBILE_MONEY", enum: ["MOBILE_MONEY", "BANK_ACCOUNT"] },
                momoNetwork: { type: "string", example: "MTN" },
                momoNumber: { type: "string", example: "0241234567" },
                momoAccountName: { type: "string", example: "Admin Name" },
                bankName: { type: "string", example: "GCB Bank" },
                bankAccountNumber: { type: "string", example: "1234567890" },
                bankAccountName: { type: "string", example: "Admin Name" }
              }
            }
          }
        }
     }
  */
  try {
    const {
      amount,
      payoutMethod,
      momoNetwork,
      momoNumber,
      momoAccountName,
      bankName,
      bankAccountNumber,
      bankAccountName
    } = req.body;

    // 1. Strict Amount Validation
    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      throw new AppError('Withdrawal amount must be a positive number greater than 0.', 400);
    }

    // 2. Strict Payout Method Validation
    if (!payoutMethod || !['MOBILE_MONEY', 'BANK_ACCOUNT'].includes(payoutMethod)) {
      throw new AppError('Invalid payout method. Must be MOBILE_MONEY or BANK_ACCOUNT.', 400);
    }

    let recipientName = '';
    let recipientNumber = '';
    let channel = '';

    if (payoutMethod === 'MOBILE_MONEY') {
      if (!momoNetwork || !momoNetwork.trim()) {
        throw new AppError('Mobile Money network (e.g. MTN, Telecel, AirtelTigo) is required.', 400);
      }
      if (!momoNumber || !momoNumber.trim()) {
        throw new AppError('Mobile Money phone number is required.', 400);
      }
      if (!momoAccountName || !momoAccountName.trim()) {
        throw new AppError('Mobile Money registered account name is required.', 400);
      }
      channel = momoNetwork.trim();
      recipientNumber = momoNumber.trim();
      recipientName = momoAccountName.trim();
    } else if (payoutMethod === 'BANK_ACCOUNT') {
      if (!bankName || !bankName.trim()) {
        throw new AppError('Bank name is required.', 400);
      }
      if (!bankAccountNumber || !bankAccountNumber.trim()) {
        throw new AppError('Bank account number is required.', 400);
      }
      if (!bankAccountName || !bankAccountName.trim()) {
        throw new AppError('Bank account name is required.', 400);
      }
      channel = bankName.trim();
      recipientNumber = bankAccountNumber.trim();
      recipientName = bankAccountName.trim();
    }

    // 3. Step-up check: this endpoint sends money to any account typed in, so the admin must
    // confirm with their password. A stolen session alone is not enough.
    await verifyStepUp(req.user.id, { password: req.body.currentPassword, twoFactorCode: req.body.twoFactorCode });

    // 4. Record the payout BEFORE sending it, so money can never leave without a record
    const adminWithdrawalRecord = await prisma.adminWithdrawal.create({
      data: {
        adminId: req.user.id,
        amount: withdrawAmount,
        payoutMethod,
        accountDetails: JSON.stringify({
          method: payoutMethod,
          recipientName,
          recipientNumber,
          channel
        }),
        status: 'PROCESSING'
      }
    });

    // The record id doubles as the Hubtel client reference, so a repeated call is rejected by Hubtel
    const adminRef = referenceFor(adminWithdrawalRecord.id);

    // 5. Initiate Immediate Transfer via Hubtel Payout API
    let payoutResult;
    try {
      payoutResult = await sendHubtelPayout({
        recipientName,
        recipientNumber,
        amount: withdrawAmount,
        payoutMethod,
        channel,
        clientReference: adminRef,
        description: `Admin Direct Withdrawal by ${req.user.fullName || 'Admin'}`
      });
    } catch (payoutErr) {
      await prisma.adminWithdrawal.update({
        where: { id: adminWithdrawalRecord.id },
        data: { status: 'FAILED', failureReason: payoutErr.message, transactionRef: adminRef }
      });

      logActivity({
        userId: req.user.id,
        action: 'ADMIN_DIRECT_WITHDRAWAL_FAILED',
        details: { withdrawalId: adminWithdrawalRecord.id, amount: withdrawAmount, error: payoutErr.message },
        req
      });

      throw new AppError(`Payout transfer failed: ${payoutErr.message}. Confirm with Hubtel before retrying.`, 400);
    }

    // Stays PROCESSING until Hubtel confirms (code 0001 means "accepted, not final yet")
    await prisma.adminWithdrawal.update({
      where: { id: adminWithdrawalRecord.id },
      data: {
        status: payoutResult.pending ? 'PROCESSING' : 'COMPLETED',
        transactionRef: payoutResult.transactionId || adminRef
      }
    });

    const completedRecord = await prisma.adminWithdrawal.findUnique({ where: { id: adminWithdrawalRecord.id } });

    // 5. Audit Logging
    logActivity({
      userId: req.user.id,
      action: 'ADMIN_DIRECT_WITHDRAWAL',
      details: {
        withdrawalId: adminWithdrawalRecord.id,
        amount: withdrawAmount,
        payoutMethod,
        recipientName,
        recipientNumber,
        transactionRef: completedRecord.transactionRef
      },
      req
    });

    return res.status(200).json({
      success: true,
      message: payoutResult.pending
        ? `Admin withdrawal of GHS ${withdrawAmount.toFixed(2)} sent to Hubtel. It will be confirmed shortly.`
        : `Admin withdrawal of GHS ${withdrawAmount.toFixed(2)} processed successfully.`,
      data: completedRecord
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to process admin direct withdrawal.', 500));
  }
};

/**
 * Get history of admin direct money withdrawals.
 */
export const getAdminDirectWithdrawalsHistory = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Get Admin Direct Withdrawal History'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      prisma.adminWithdrawal.findMany({
        include: {
          admin: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.adminWithdrawal.count()
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      data: records
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch admin withdrawal history', 500));
  }
};

/**
 * Admin delete affiliate profile.
 */
export const deleteAffiliateAdmin = async (req, res, next) => {
  // #swagger.tags = ['Admin - Affiliates']
  // #swagger.summary = 'Delete Affiliate Profile'
  // #swagger.description = 'Permanently deletes an affiliate profile and user account.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { id } = req.params;

    const profile = await prisma.affiliateProfile.findFirst({
      where: { id },
      select: { id: true, userId: true, affiliateCode: true }
    });

    if (!profile) {
      await prisma.affiliateProfile.delete({ where: { id } }).catch(() => {});
      throw new AppError('Affiliate profile not found.', 404);
    }

    // 1. Explicitly delete affiliate profile first so USSD code and profile are completely removed
    await prisma.affiliateProfile.delete({
      where: { id }
    });

    // 2. Delete user account if present
    if (profile.userId) {
      await prisma.user.delete({
        where: { id: profile.userId }
      }).catch(() => {});
    }

    logActivity({
      userId: req.user.id,
      action: 'AFFILIATE_DELETED_BY_ADMIN',
      details: { affiliateId: id, affiliateCode: profile.affiliateCode, email: profile.user?.email },
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Affiliate profile deleted successfully.'
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to delete affiliate profile', 500));
  }
};


