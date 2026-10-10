import bcrypt from 'bcryptjs';
import { prisma } from '../../config/config.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateTwoFactorChallengeToken, verifyTwoFactorChallengeToken } from '../../utils/jwt/jwt.js';
import { AppError } from '../../utils/error/AppError.js';
import { sendEmail } from '../../utils/email/email.js';
import { sendSMS } from '../../utils/sms/smsHelper.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { assertAccountNotLocked, recordFailedLogin, clearFailedLogins } from '../../utils/auth/loginGuard.js';
import { issueOtpCode, checkOtpCode, OTP_TTL_MS } from '../../utils/auth/otp.js';
import { verifyAccountPassword } from '../../utils/auth/stepUp.js';
import {
  generateTwoFactorSecret,
  buildEnrolmentDetails,
  storePendingSecret,
  verifyTwoFactorCode,
  verifyTwoFactorChallenge,
  issueRecoveryCodes,
  disableTwoFactor
} from '../../utils/auth/twoFactor.js';

/**
 * Creates a signed-in session: issues the token pair, stores the refresh token,
 * clears the first-time-login flag and records the login.
 *
 * Used by the normal login and by the two-factor step, so both return the same shape.
 *
 * @param {Object} user - The authenticated user
 * @param {Object} req - Express request, for the activity log
 * @returns {Promise<Object>} The `data` payload for the login response
 */
const issueSession = async (user, req) => {
  const wasFirstTime = user.firstTimeLogin;
  if (wasFirstTime) {
    await prisma.user.update({
      where: { id: user.id },
      data: { firstTimeLogin: false }
    });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days expiry
    }
  });

  // Fetch latest 10 activity logs for the user
  const activityLogs = await prisma.activityLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  logActivity({
    userId: user.id,
    action: 'USER_LOGIN',
    details: { email: user.email, twoFactor: user.twoFactorEnabled === true },
    req
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      // Send it as true in the response, even though it's now updated to false in the DB
      firstTimeLogin: wasFirstTime,
      isActive: user.isActive,
      twoFactorEnabled: user.twoFactorEnabled === true,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      activityLogs
    }
  };
};

/**
 * Controller for logging in a user.
 */
export const login = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'User Login'
  // #swagger.description = 'Authenticates user credentials and returns access & refresh tokens.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LoginRequest" }
          }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'Login successful',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LoginResponse" }
          }
        }
     }
  */
  /* #swagger.responses[401] = {
        description: 'Unauthorized access',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
     }
  */
  try {
    const { email, password } = req.body;

    // 1. Find user by email
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    // 2. Refuse while the account is locked after repeated wrong passwords
    assertAccountNotLocked(user);

    // 3. Verify password (before revealing anything else about the account)
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await recordFailedLogin(user);
      throw new AppError('Invalid email or password', 401);
    }

    // Check if user account is active
    if (!user.isActive) {
      throw new AppError('Your account is deactivated. Please contact support.', 403);
    }

    await clearFailedLogins(user);

    // 4. Accounts with two-factor sign-in get no session yet: they must pass the code step.
    // The challenge token grants no access on its own and expires in minutes.
    if (user.twoFactorEnabled) {
      logActivity({
        userId: user.id,
        action: 'USER_LOGIN_PASSWORD_OK_2FA_REQUIRED',
        details: { email: user.email },
        req
      });

      return res.status(200).json({
        success: true,
        message: 'Password accepted. Enter the code from your authenticator app.',
        data: {
          twoFactorRequired: true,
          challengeToken: generateTwoFactorChallengeToken(user)
        }
      });
    }

    const session = await issueSession(user, req);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: session
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred during login. Please try again.', 500));
    }
  }
};

/**
 * Controller for refreshing tokens.
 */
export const refresh = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Refresh Session Tokens'
  // #swagger.description = 'Rotates the refresh token and returns a new access & refresh token pair.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RefreshRequest" }
          }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'Tokens refreshed successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RefreshResponse" }
          }
        }
     }
  */
  /* #swagger.responses[401] = {
        description: 'Unauthorized or invalid token',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
     }
  */
  try {
    const { refreshToken } = req.body;

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      throw new AppError('Invalid or expired refresh token. Please log in again.', 401);
    }

    // Find token statefully in the database
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken }
    });

    if (!storedToken || storedToken.isRevoked || new Date(storedToken.expiresAt) < new Date()) {
      throw new AppError('Invalid or expired refresh token. Please log in again.', 401);
    }

    // Find user in the database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!user) {
      throw new AppError('The user belonging to this token no longer exists.', 404);
    }

    if (!user.isActive) {
      throw new AppError('Your account is deactivated. Please contact support.', 403);
    }

    // Revoke the old refresh token statefully (Refresh Token Rotation)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true }
    });

    // Generate new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    // Save the new refresh token statefully in the database
    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while refreshing your session. Please log in again.', 500));
    }
  }
};

/**
 * Controller for logging out a user.
 */
export const logout = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'User Logout'
  // #swagger.description = 'Revokes the user\'s refresh token in the database.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LogoutRequest" }
          }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'Logged out successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LogoutResponse" }
          }
        }
     }
  */
  /* #swagger.responses[400] = {
        description: 'Invalid input data',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
     }
  */
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token is required to log out', 400);
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken }
    });

    // Revoke the refresh token statefully in the database
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { isRevoked: true }
    });

    if (storedToken) {
      logActivity({
        userId: storedToken.userId,
        action: 'USER_LOGOUT',
        details: { token: refreshToken.substring(0, 15) + '...' },
        req
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred during logout. Please try again.', 500));
    }
  }
};

/**
 * Controller for requesting password reset OTP.
 */
export const forgotPassword = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Request Password Reset OTP'
  // #swagger.description = 'Generates a temporary OTP and sends it to the user\'s registered email address.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ForgotPasswordRequest" }
          }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'OTP sent successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ForgotPasswordResponse" }
          }
        }
     }
  */
  /* #swagger.responses[404] = {
        description: 'User not found',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
     }
  */
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({
      where: { email }
    });

    // Same answer whether or not the account exists, so this endpoint cannot be used to discover accounts
    const genericResponse = {
      success: true,
      message: 'If an account exists for this email, a verification code has been sent to its registered phone number.'
    };

    if (!user || !user.isActive) {
      return res.status(200).json(genericResponse);
    }

    const otpCode = await issueOtpCode(user.id);
    const validMinutes = Math.round(OTP_TTL_MS / 60000);

    // Deliver without waiting, so response time does not reveal whether the account exists
    const deliverCode = async () => {
      if (user.phoneNumber) {
        await sendSMS({
          to: user.phoneNumber,
          message: `CivicTree: Your password reset code is ${otpCode}. It expires in ${validMinutes} minutes. If you did not request this, ignore this message.`
        });
      } else {
        console.warn(`[PASSWORD RESET] User ${user.id} has no phone number; the code can only be sent by email.`);
      }

      await sendEmail({
        to: user.email,
        subject: 'Password Reset OTP - CivicTree',
        html: `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2>Password Reset OTP Code</h2>
        <p>We received a request to reset your password. Use the following 6-digit One-Time Password (OTP) to proceed. This code is valid for ${validMinutes} minutes.</p>
        <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; border-radius: 4px; margin: 20px 0;">
          ${otpCode}
        </div>
        <p>If you did not request a password reset, please ignore this email.</p>
      </div>
    `
      });
    };
    deliverCode().catch((err) => console.error('[PASSWORD RESET] Failed to deliver code:', err.message));

    logActivity({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      details: { email: user.email, delivery: user.phoneNumber ? 'SMS' : 'EMAIL_ONLY' },
      req
    });

    return res.status(200).json(genericResponse);
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while sending the recovery code. Please try again later.', 500));
    }
  }
};

/**
 * Controller for validating a password reset OTP.
 */
export const validateOtp = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Validate Password Reset OTP'
  // #swagger.description = 'Verifies whether the provided OTP is valid and has not expired.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ValidateOtpRequest" }
          }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'OTP validated successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ValidateOtpResponse" }
          }
        }
     }
  */
  /* #swagger.responses[400] = {
        description: 'Invalid or expired OTP',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
     }
  */
  try {
    const { email, otp } = req.body;

    const user = await prisma.user.findUnique({
      where: { email }
    });

    // Same error for unknown accounts and wrong codes
    const storedOtp = user && user.isActive ? await checkOtpCode(user.id, otp) : null;

    if (!storedOtp) {
      throw new AppError('Invalid or expired OTP code.', 400);
    }

    return res.status(200).json({
      success: true,
      message: 'OTP validated successfully.'
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while validating the code. Please try again.', 500));
    }
  }
};

/**
 * Controller for resetting a password using a validated OTP.
 */
export const resetPassword = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Reset Password'
  // #swagger.description = 'Resets the user\'s password using the validated OTP and invalidates active refresh tokens.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ResetPasswordRequest" }
          }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'Password reset successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ResetPasswordResponse" }
          }
        }
     }
  */
  /* #swagger.responses[400] = {
        description: 'Invalid data or mismatching passwords',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
     }
  */
  try {
    const { email, otp, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { email }
    });

    // Same error for unknown accounts and wrong codes
    const storedOtp = user && user.isActive ? await checkOtpCode(user.id, otp) : null;

    if (!storedOtp) {
      throw new AppError('Invalid or expired OTP code.', 400);
    }

    // Use the code up; only one of several simultaneous requests can succeed
    const consumed = await prisma.otp.updateMany({
      where: { id: storedOtp.id, isUsed: false },
      data: { isUsed: true }
    });

    if (consumed.count !== 1) {
      throw new AppError('Invalid or expired OTP code.', 400);
    }

    // Hash the new password using bcryptjs
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user's password and lift any login lockout
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, failedLoginAttempts: 0, lockedUntil: null }
    });

    // Tell the owner, so an unexpected reset is noticed
    if (user.phoneNumber) {
      sendSMS({
        to: user.phoneNumber,
        message: 'CivicTree: Your account password was just reset. If this was not you, contact the CivicTree administrator immediately.'
      }).catch((err) => console.error('[PASSWORD RESET] Failed to send reset notice:', err.message));
    }

    // Revoke all refresh tokens for security (forces re-login on all devices)
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { isRevoked: true }
    });

    logActivity({
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      details: { email: user.email },
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully. You can now log in.'
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while resetting your password. Please try again.', 500));
    }
  }
};

/**
 * Change password for the authenticated user
 * PATCH /api/auth/change-password
 */
export const changePassword = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Change password'
  // #swagger.description = 'Changes the password for the currently logged-in user.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        currentPassword: { type: "string", example: "oldpassword123" },
                        newPassword: { type: "string", example: "newpassword123" },
                        confirmPassword: { type: "string", example: "newpassword123" }
                    },
                    required: ["currentPassword", "newPassword", "confirmPassword"]
                }
            }
        }
     } */
  /* #swagger.responses[200] = {
        description: 'Password changed successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string", example: "Password changed successfully." }
              }
            }
          }
        }
     }
  */
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      throw new AppError('Current password, new password, and confirmation are required.', 400);
    }

    if (newPassword.length < 8) {
      throw new AppError('New password must be at least 8 characters long.', 400);
    }

    if (newPassword !== confirmPassword) {
      throw new AppError('New password and confirmation do not match.', 400);
    }

    // Fetch user from DB (to get current password hash)
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      throw new AppError('User not found.', 404);
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid current password.', 400);
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user's password
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    // Revoke all refresh tokens for security (forces re-login on all devices/sessions)
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { isRevoked: true }
    });

    logActivity({
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      details: { email: user.email },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully.'
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while changing password.', 500));
    }
  }
};



/**
 * Second login step: exchange a two-factor challenge token plus a code for a session.
 * Accepts a code from the authenticator app or one of the user's recovery codes.
 * POST /api/auth/login/two-factor
 */
export const completeTwoFactorLogin = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Complete login with a two-factor code'
  try {
    const { challengeToken, code } = req.body;

    let decoded;
    try {
      decoded = verifyTwoFactorChallengeToken(challengeToken);
    } catch {
      throw new AppError('This sign-in attempt has expired. Please log in again.', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });

    if (!user || !user.twoFactorEnabled) {
      throw new AppError('This sign-in attempt is no longer valid. Please log in again.', 401);
    }

    assertAccountNotLocked(user);

    if (!user.isActive) {
      throw new AppError('Your account is deactivated. Please contact support.', 403);
    }

    const result = await verifyTwoFactorChallenge(user, code);

    if (!result.ok) {
      // Wrong codes count towards the same lockout as wrong passwords
      await recordFailedLogin(user);
      logActivity({
        userId: user.id,
        action: 'USER_2FA_FAILED',
        details: { email: user.email },
        req
      });
      throw new AppError('That code is not valid. Check your authenticator app and try again.', 401);
    }

    await clearFailedLogins(user);

    if (result.usedRecoveryCode) {
      const remaining = await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id, usedAt: null } });

      logActivity({
        userId: user.id,
        action: 'USER_2FA_RECOVERY_CODE_USED',
        details: { email: user.email, remaining },
        req
      });

      if (user.phoneNumber) {
        sendSMS({
          to: user.phoneNumber,
          message: `CivicTree: A recovery code was used to sign in to your account. ${remaining} code(s) left. If this was not you, contact the administrator immediately.`
        }).catch((err) => console.error('[2FA] Failed to send recovery code notice:', err.message));
      }
    }

    const session = await issueSession(user, req);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        ...session,
        usedRecoveryCode: result.usedRecoveryCode,
        recoveryCodesRemaining: result.usedRecoveryCode
          ? await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id, usedAt: null } })
          : undefined
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError('An unexpected error occurred while checking your code.', 500));
  }
};

/**
 * Whether two-factor sign-in is on for the signed-in user.
 * GET /api/auth/two-factor
 */
export const getTwoFactorStatus = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Two-factor status'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const [user, unusedRecoveryCodes] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.id }, select: { twoFactorEnabled: true, twoFactorSecret: true } }),
      prisma.twoFactorRecoveryCode.count({ where: { userId: req.user.id, usedAt: null } })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        enabled: user.twoFactorEnabled,
        setupStarted: Boolean(user.twoFactorSecret) && !user.twoFactorEnabled,
        recoveryCodesRemaining: unusedRecoveryCodes
      }
    });
  } catch (error) {
    next(new AppError('Failed to read two-factor status.', 500));
  }
};

/**
 * Starts enrolment: creates a secret and returns the QR code to scan.
 * The secret only takes effect once a valid code is confirmed.
 * POST /api/auth/two-factor/setup
 */
export const setupTwoFactor = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Start two-factor setup'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const user = await verifyAccountPassword(req.user.id, req.body.currentPassword);

    if (user.twoFactorEnabled) {
      throw new AppError('Two-factor sign-in is already on. Turn it off first if you want to set it up again.', 400);
    }

    const secret = generateTwoFactorSecret();
    await storePendingSecret(user.id, secret);
    const { otpauthUrl, qrCodeDataUrl } = await buildEnrolmentDetails(user.email, secret);

    logActivity({
      userId: user.id,
      action: 'USER_2FA_SETUP_STARTED',
      details: { email: user.email },
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Scan the QR code with your authenticator app, then enter a code to finish.',
      data: {
        qrCodeDataUrl,
        otpauthUrl,
        // Shown so the secret can be typed in if the QR code cannot be scanned
        manualEntryKey: secret
      }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError('Failed to start two-factor setup.', 500));
  }
};

/**
 * Finishes enrolment: checks a code from the app, switches two-factor on and
 * returns the recovery codes, which are shown once and never again.
 * POST /api/auth/two-factor/enable
 */
export const enableTwoFactor = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Turn on two-factor sign-in'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { code } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user.twoFactorSecret) {
      throw new AppError('Start two-factor setup first.', 400);
    }
    if (user.twoFactorEnabled) {
      throw new AppError('Two-factor sign-in is already on.', 400);
    }

    if (!(await verifyTwoFactorCode(user, code))) {
      throw new AppError('That code is not valid. Check your authenticator app and try again.', 400);
    }

    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    const recoveryCodes = await issueRecoveryCodes(user.id);

    // Other sessions keep working, but a new sign-in now needs a code
    logActivity({
      userId: user.id,
      action: 'USER_2FA_ENABLED',
      details: { email: user.email },
      req
    });

    if (user.phoneNumber) {
      sendSMS({
        to: user.phoneNumber,
        message: 'CivicTree: Two-factor sign-in was turned on for your account. If this was not you, contact the administrator immediately.'
      }).catch((err) => console.error('[2FA] Failed to send enable notice:', err.message));
    }

    return res.status(200).json({
      success: true,
      message: 'Two-factor sign-in is on. Save these recovery codes somewhere safe — they are shown only once.',
      data: { recoveryCodes }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError('Failed to turn on two-factor sign-in.', 500));
  }
};

/**
 * Turns two-factor off. Needs the account password and a current code,
 * so a stolen session cannot remove it.
 * POST /api/auth/two-factor/disable
 */
export const disableTwoFactorSignIn = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Turn off two-factor sign-in'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const user = await verifyAccountPassword(req.user.id, req.body.currentPassword);

    if (!user.twoFactorEnabled) {
      throw new AppError('Two-factor sign-in is not on for this account.', 400);
    }

    const result = await verifyTwoFactorChallenge(user, req.body.code);
    if (!result.ok) {
      throw new AppError('That code is not valid. Check your authenticator app and try again.', 400);
    }

    await disableTwoFactor(user.id);

    logActivity({
      userId: user.id,
      action: 'USER_2FA_DISABLED',
      details: { email: user.email },
      req
    });

    if (user.phoneNumber) {
      sendSMS({
        to: user.phoneNumber,
        message: 'CivicTree: Two-factor sign-in was turned OFF for your account. If this was not you, contact the administrator immediately.'
      }).catch((err) => console.error('[2FA] Failed to send disable notice:', err.message));
    }

    return res.status(200).json({
      success: true,
      message: 'Two-factor sign-in is off.'
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError('Failed to turn off two-factor sign-in.', 500));
  }
};

/**
 * Replaces the recovery codes with a new set.
 * POST /api/auth/two-factor/recovery-codes
 */
export const regenerateRecoveryCodes = async (req, res, next) => {
  // #swagger.tags = ['Authentication']
  // #swagger.summary = 'Get a new set of recovery codes'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const user = await verifyAccountPassword(req.user.id, req.body.currentPassword);

    if (!user.twoFactorEnabled) {
      throw new AppError('Two-factor sign-in is not on for this account.', 400);
    }

    if (!(await verifyTwoFactorCode(user, req.body.code))) {
      throw new AppError('That code is not valid. Check your authenticator app and try again.', 400);
    }

    const recoveryCodes = await issueRecoveryCodes(user.id);

    logActivity({
      userId: user.id,
      action: 'USER_2FA_RECOVERY_CODES_REISSUED',
      details: { email: user.email },
      req
    });

    return res.status(200).json({
      success: true,
      message: 'New recovery codes issued. The old ones no longer work.',
      data: { recoveryCodes }
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError('Failed to issue new recovery codes.', 500));
  }
};
