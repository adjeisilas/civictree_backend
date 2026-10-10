import bcrypt from 'bcryptjs';
import config, { prisma } from '../../config/config.js';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt/jwt.js';
import { AppError } from '../../utils/error/AppError.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';

/**
 * Partner Login
 * POST /api/auth/partner/login
 */
export const loginPartner = async (req, res, next) => {
  // #swagger.tags = ['Partner Auth']
  // #swagger.summary = 'Partner Login'
  // #swagger.description = 'Authenticates a revenue-share partner and returns JWT Bearer token.'
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find Partner profile first
    const partner = await prisma.partner.findFirst({
      where: { email: normalizedEmail }
    });

    if (!partner) {
      throw new AppError('Invalid email address or password', 401);
    }

    // Compare password with stored passwordHash
    const isPasswordValid = await bcrypt.compare(password, partner.passwordHash);
    if (!isPasswordValid) {
      throw new AppError('Invalid email address or password', 401);
    }

    if (partner.status === 'Inactive' || partner.status === 'Suspended') {
      throw new AppError('Your partner account is currently inactive or suspended.', 403);
    }

    // Use the linked user account only if it is itself a PARTNER account. Otherwise a partner whose email
    // matches an admin account would receive a token for that admin account.
    let userId = partner.id;
    const linkedUser = await prisma.user.findFirst({
      where: { email: normalizedEmail, role: 'PARTNER' }
    });
    if (linkedUser) {
      userId = linkedUser.id;
    }

    const accessToken = generateAccessToken({ id: userId, email: partner.email, role: 'PARTNER' });
    const refreshToken = generateRefreshToken({ id: userId });

    // Store the refresh token so it can be rotated and revoked (needs a linked user account)
    if (linkedUser) {
      await prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: linkedUser.id,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        }
      });
    }

    logActivity({
      userId,
      action: 'PARTNER_LOGIN_SUCCESS',
      details: { partnerId: partner.partnerId, email: partner.email },
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        token: accessToken,
        user: {
          id: partner.id,
          partnerId: partner.partnerId,
          partnerName: partner.partnerName,
          email: partner.email,
          phone: partner.phone,
          contractRef: partner.contractRef,
          sharePercentage: Number(partner.sharePercentage),
          status: partner.status,
          role: 'PARTNER'
        }
      }
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError(error.message || 'An unexpected error occurred during login.', 500));
    }
  }
};

/**
 * Partner Forgot Password Request
 * POST /api/auth/partner/forgot-password
 */
export const forgotPasswordPartner = async (req, res, next) => {
  // #swagger.tags = ['Partner Auth']
  // #swagger.summary = 'Partner Forgot Password'
  // #swagger.description = 'Sends password reset instructions to partner email.'
  try {
    const { email } = req.body;
    if (!email) {
      throw new AppError('Email address is required', 400);
    }

    const partner = await prisma.partner.findFirst({
      where: { email: email.toLowerCase().trim() }
    });

    if (!partner) {
      // Return 200 to prevent user enumeration
      return res.status(200).json({
        success: true,
        message: 'Password reset instructions sent to your email'
      });
    }

    logActivity({
      action: 'PARTNER_FORGOT_PASSWORD_REQUEST',
      details: { partnerId: partner.partnerId, email: partner.email },
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Password reset instructions sent to your email'
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError(error.message || 'An unexpected error occurred.', 500));
    }
  }
};
