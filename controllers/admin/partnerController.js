import bcrypt from 'bcryptjs';
import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';

/**
 * Get all Partners
 * GET /api/admin/partners
 */
export const getAllPartners = async (req, res, next) => {
  // #swagger.tags = ['Admin - Partner Management']
  // #swagger.summary = 'Get All Revenue-Share Partners'
  try {
    const partners = await prisma.partner.findMany({
      include: {
        payoutAccounts: true,
        settings: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: partners
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch partners.', 500));
  }
};

/**
 * Create / Onboard New Partner
 * POST /api/admin/partners
 */
export const createPartnerAdmin = async (req, res, next) => {
  // #swagger.tags = ['Admin - Partner Management']
  // #swagger.summary = 'Create / Onboard New Partner'
  try {
    const { partnerName, legalEntityName, email, phone, password, contractRef, sharePercentage = 5.0 } = req.body;

    if (!partnerName || !email || !phone || !password) {
      throw new AppError('partnerName, email, phone, and password are required.', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingPartner = await prisma.partner.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { phone: phone.trim() }
        ]
      }
    });

    if (existingPartner) {
      throw new AppError('A partner with this email or phone number already exists.', 400);
    }

    const partnerCount = await prisma.partner.count();
    const partnerId = `PRT-${8800 + partnerCount + 1}`;
    const generatedContractRef = contractRef || `CTR-REV-${new Date().getFullYear()}-${partnerCount + 1}`;
    const hashedPassword = await bcrypt.hash(password, 12);

    const partner = await prisma.partner.create({
      data: {
        partnerId,
        partnerName: partnerName.trim(),
        legalEntityName: legalEntityName ? legalEntityName.trim() : null,
        email: normalizedEmail,
        phone: phone.trim(),
        passwordHash: hashedPassword,
        contractRef: generatedContractRef,
        sharePercentage: parseFloat(sharePercentage) || 5.0,
        status: 'Active',
        payoutAccounts: {
          create: {
            type: 'MOMO',
            provider: 'MTN Mobile Money',
            accountNumber: phone.trim(),
            accountName: partnerName.trim(),
            isDefault: true
          }
        },
        settings: {
          create: {
            autoSettlementEnabled: true,
            settlementFrequency: 'DAILY'
          }
        }
      },
      include: {
        payoutAccounts: true,
        settings: true
      }
    });

    // Ensure corresponding User row exists for role checks
    const existingUser = await prisma.user.findFirst({ where: { email: normalizedEmail } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          fullName: partnerName.trim(),
          email: normalizedEmail,
          phoneNumber: phone.trim(),
          password: hashedPassword,
          role: 'PARTNER',
          firstTimeLogin: false,
          isActive: true
        }
      });
    }

    logActivity({
      userId: req.user.id,
      action: 'ADMIN_PARTNER_CREATED',
      details: { partnerId: partner.partnerId, partnerName: partner.partnerName },
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Partner account created successfully.',
      data: partner
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to create partner account.', 500));
  }
};

/**
 * Get Partner Details by ID
 * GET /api/admin/partners/:id
 */
export const getPartnerByIdAdmin = async (req, res, next) => {
  // #swagger.tags = ['Admin - Partner Management']
  // #swagger.summary = 'Get Partner Details by ID'
  try {
    const { id } = req.params;
    const partner = await prisma.partner.findFirst({
      where: {
        OR: [
          { id },
          { partnerId: id }
        ]
      },
      include: {
        payoutAccounts: true,
        settings: true,
        settlements: { orderBy: { requestedAt: 'desc' }, take: 10 },
        transactions: { orderBy: { createdAt: 'desc' }, take: 10 }
      }
    });

    if (!partner) {
      throw new AppError('Partner not found.', 404);
    }

    return res.status(200).json({
      success: true,
      data: partner
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to fetch partner details.', 500));
  }
};

/**
 * Update Partner Profile by Admin
 * PUT /api/admin/partners/:id
 */
export const updatePartnerAdmin = async (req, res, next) => {
  // #swagger.tags = ['Admin - Partner Management']
  // #swagger.summary = 'Update Partner Account'
  try {
    const { id } = req.params;
    const { partnerName, legalEntityName, email, phone, status, sharePercentage } = req.body;

    const updateData = {};
    if (partnerName) updateData.partnerName = partnerName.trim();
    if (legalEntityName) updateData.legalEntityName = legalEntityName.trim();
    if (email) updateData.email = email.toLowerCase().trim();
    if (phone) updateData.phone = phone.trim();
    if (status) updateData.status = status;
    if (sharePercentage !== undefined) updateData.sharePercentage = parseFloat(sharePercentage);

    const partner = await prisma.partner.update({
      where: { id },
      data: updateData
    });

    logActivity({
      userId: req.user.id,
      action: 'ADMIN_PARTNER_UPDATED',
      details: { partnerId: partner.partnerId, updatedFields: Object.keys(updateData) },
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Partner account updated successfully.',
      data: partner
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update partner account.', 500));
  }
};
