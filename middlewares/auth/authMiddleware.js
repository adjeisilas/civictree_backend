import { AppError } from '../../utils/error/AppError.js';
import { verifyAccessToken, getTokenFromHeader } from '../../utils/jwt/jwt.js';
import { prisma } from '../../config/config.js';

/**
 * Middleware to protect routes by validating the Access Token.
 */
export const protect = async (req, res, next) => {
  try {
    const token = getTokenFromHeader(req);
    if (!token) {
      throw new AppError('You are not logged in. Please log in to get access.', 401);
    }

    // 1. Verify access token
    const decoded = verifyAccessToken(token);

    // A two-factor challenge token is not a session token
    if (decoded.typ && decoded.typ !== 'access') {
      throw new AppError('Invalid token. Please log in again.', 401);
    }

    // 2. Check if user still exists in the database (User or Partner table)
    let user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!user) {
      const partner = await prisma.partner.findFirst({
        where: {
          OR: [
            { id: decoded.id },
            { partnerId: decoded.id }
          ]
        }
      });
      if (partner) {
        user = {
          id: partner.id,
          fullName: partner.partnerName,
          email: partner.email,
          role: 'PARTNER',
          isActive: partner.status === 'Active'
        };
      }
    }

    if (!user) {
      throw new AppError('The user belonging to this token no longer exists.', 401);
    }

    // A token issued by partner login must only ever act as a partner
    if (decoded.role === 'PARTNER' && user.role !== 'PARTNER') {
      throw new AppError('Invalid token. Please log in again.', 401);
    }

    // 3. Check if user is active
    if (!user.isActive) {
      throw new AppError('Your account is deactivated or inactive. Please contact support.', 403);
    }

    // Grant access to protected route and attach user to request object
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(new AppError('Invalid token. Please log in again.', 401));
    } else if (error.name === 'TokenExpiredError') {
      next(new AppError('Your token has expired. Please log in again.', 401));
    } else if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while validating authentication. Please try again.', 500));
    }
  }
};

/**
 * Middleware to restrict route access to specific roles (e.g., ADMIN).
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('You are not logged in.', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }
    next();
  };
};
