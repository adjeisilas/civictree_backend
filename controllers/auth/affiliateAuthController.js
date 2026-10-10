import bcrypt from 'bcryptjs';
import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt/jwt.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { notifyAdminsNewAffiliateApplication } from '../../utils/notification/affiliateNotificationHelper.js';
import { generateNextAffiliateCode } from '../../utils/affiliate/affiliateCodeGenerator.js';
import { assertAccountNotLocked, recordFailedLogin, clearFailedLogins } from '../../utils/auth/loginGuard.js';

/**
 * Register a new affiliate applicant (Two-step registration).
 */
export const registerAffiliate = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Auth']
  // #swagger.summary = 'Register New Affiliate'
  // #swagger.description = 'Registers a new affiliate user with personal information and payout account details (Mobile Money or Bank Account). Initial status is set to PENDING awaiting admin approval.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["fullName", "phoneNumber", "email", "password", "payoutMethod"],
              properties: {
                fullName: { type: "string", example: "John Mensah" },
                businessName: { type: "string", example: "JM Sales" },
                phoneNumber: { type: "string", example: "0241234567" },
                email: { type: "string", example: "john@example.com" },
                location: { type: "string", example: "Accra, Greater Accra" },
                password: { type: "string", example: "Password123" },
                payoutMethod: { type: "string", example: "MOBILE_MONEY", enum: ["MOBILE_MONEY", "BANK_ACCOUNT"] },
                momoNetwork: { type: "string", example: "MTN" },
                momoNumber: { type: "string", example: "0241234567" },
                momoAccountName: { type: "string", example: "John Mensah" },
                bankName: { type: "string", example: "GCB Bank" },
                bankAccountNumber: { type: "string", example: "1234567890" },
                bankAccountName: { type: "string", example: "John Mensah" }
              }
            }
          }
        }
     }
  */
  /* #swagger.responses[201] = {
        description: 'Affiliate application submitted successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string", example: "Affiliate application submitted successfully. Please wait for admin approval." },
                data: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    affiliateCode: { type: "string", example: "AFF-1001" },
                    status: { type: "string", example: "PENDING" }
                  }
                }
              }
            }
          }
        }
     }
  */
  try {
    const {
      fullName,
      businessName,
      phoneNumber,
      email,
      location,
      password,
      payoutMethod,
      momoNetwork,
      momoNumber,
      momoAccountName,
      bankName,
      bankAccountNumber,
      bankAccountName
    } = req.body;

    // Validation
    if (!fullName || !phoneNumber || !email || !password) {
      throw new AppError('Full name, phone number, email, and password are required.', 400);
    }

    if (!payoutMethod || !['MOBILE_MONEY', 'BANK_ACCOUNT'].includes(payoutMethod)) {
      throw new AppError('Invalid payout method. Must be MOBILE_MONEY or BANK_ACCOUNT.', 400);
    }

    if (payoutMethod === 'MOBILE_MONEY' && (!momoNetwork || !momoNumber || !momoAccountName)) {
      throw new AppError('Mobile Money network, MoMo number, and account name are required.', 400);
    }

    if (payoutMethod === 'BANK_ACCOUNT' && (!bankName || !bankAccountNumber || !bankAccountName)) {
      throw new AppError('Bank name, account number, and account name are required.', 400);
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

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create User & AffiliateProfile in transaction
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
          status: 'PENDING',
          payoutMethod,
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

    // Notify all system administrators via SMS, HTML Email, and Push notification
    notifyAdminsNewAffiliateApplication({
      user: result.user,
      profile: result.profile
    });

    logActivity({
      userId: result.user.id,
      action: 'AFFILIATE_REGISTERED',
      details: { affiliateCode: result.profile.affiliateCode, email: result.user.email, payoutMethod },
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Affiliate application submitted successfully. Please wait for admin approval.',
      data: {
        id: result.profile.id,
        userId: result.user.id,
        fullName: result.user.fullName,
        email: result.user.email,
        affiliateCode: result.profile.affiliateCode,
        status: result.profile.status
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to register affiliate.', 500));
  }
};

/**
 * Affiliate login controller.
 */
export const loginAffiliate = async (req, res, next) => {
  // #swagger.tags = ['Affiliate Auth']
  // #swagger.summary = 'Affiliate Login'
  // #swagger.description = 'Authenticates affiliate credentials and returns session tokens. Login is restricted if affiliate application is PENDING, REJECTED, SUSPENDED, or DEACTIVATED.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", example: "john@example.com" },
                password: { type: "string", example: "Password123" }
              }
            }
          }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'Login successful',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string", example: "Login successful" },
                data: {
                  type: "object",
                  properties: {
                    accessToken: { type: "string" },
                    refreshToken: { type: "string" },
                    user: { type: "object" },
                    profile: { type: "object" }
                  }
                }
              }
            }
          }
        }
     }
  */
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required.', 400);
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { affiliateProfile: true }
    });

    if (!user || user.role !== 'AFFILIATE') {
      throw new AppError('Invalid email or password.', 401);
    }

    assertAccountNotLocked(user);

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await recordFailedLogin(user);
      throw new AppError('Invalid email or password.', 401);
    }

    if (!user.isActive) {
      throw new AppError('Your account has been deactivated.', 403);
    }

    await clearFailedLogins(user);

    const profile = user.affiliateProfile;
    if (!profile) {
      throw new AppError('Affiliate profile record not found.', 404);
    }

    // Check status
    if (profile.status === 'PENDING') {
      throw new AppError('Your affiliate application is currently pending admin approval.', 403);
    }

    if (profile.status === 'REJECTED') {
      const reason = profile.rejectionReason ? ` Reason: ${profile.rejectionReason}` : '';
      throw new AppError(`Your affiliate application was rejected.${reason}`, 403);
    }

    if (['SUSPENDED', 'DEACTIVATED'].includes(profile.status)) {
      throw new AppError(`Your affiliate account is ${profile.status.toLowerCase()}. Please contact support.`, 403);
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt
      }
    });

    logActivity({
      userId: user.id,
      action: 'AFFILIATE_LOGGED_IN',
      details: { affiliateCode: profile.affiliateCode },
      req
    });

    const { password: _, failedLoginAttempts: __, lockedUntil: ___, ...userData } = user;

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: userData,
        profile
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Affiliate login failed.', 500));
  }
};
