import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import bcrypt from 'bcryptjs';
import { ASSIGNABLE_ROLES } from '../../validators/schemas.js';

/**
 * Create a new user
 * POST /api/users
 */
export const createUser = async (req, res, next) => {
  // #swagger.tags = ['User Management']
  // #swagger.summary = 'Create a new user'
  // #swagger.description = 'Allows admins to create a new user account. Passwords are encrypted using argon2.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        fullName: { type: "string", example: "Jane Doe" },
                        email: { type: "string", example: "jane@example.com" },
                        password: { type: "string", example: "supersecret123" },
                        phoneNumber: { type: "string", example: "+1234567890" },
                        role: { type: "string", enum: ["USER", "ADMIN"], example: "USER" }
                    },
                    required: ["fullName", "email", "password"]
                }
            }
        }
     } */
  /* #swagger.responses[201] = {
        description: 'User created successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                data: {
                  type: "object",
                  properties: {
                    id: { type: "string", example: "user-uuid" },
                    fullName: { type: "string" },
                    email: { type: "string" },
                    phoneNumber: { type: "string" },
                    role: { type: "string" },
                    isActive: { type: "boolean" },
                    createdAt: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          }
        }
     }
  */
  try {
    const { fullName, email, password, phoneNumber, role } = req.body;

    if (!fullName || !email || !password) {
      throw new AppError('fullName, email, and password are required.', 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError('Please provide a valid email address.', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters long.', 400);
    }

    // Check email uniqueness
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      throw new AppError('Email address is already in use.', 400);
    }

    // Check phoneNumber uniqueness
    if (phoneNumber) {
      const existingPhone = await prisma.user.findUnique({ where: { phoneNumber } });
      if (existingPhone) {
        throw new AppError('Phone number is already in use.', 400);
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const newUser = await prisma.user.create({
      data: {
        fullName,
        email,
        password: hashedPassword,
        phoneNumber,
        role,
        firstTimeLogin: false
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    logActivity({
      userId: req.user.id,
      action: 'USER_CREATED',
      details: { targetUserId: newUser.id, targetUserEmail: newUser.email },
      req
    });

    res.status(201).json({
      success: true,
      data: newUser
    });
  } catch (error) {
    console.error('Error in createUser:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while creating the user.', 500));
    }
  }
};

/**
 * Get all users (Paginated)
 * GET /api/users
 */
export const getAllUsers = async (req, res, next) => {
  // #swagger.tags = ['User Management']
  // #swagger.summary = 'Get all users (Paginated)'
  // #swagger.description = 'Fetches a list of all user accounts with pagination, filtering, and search functionality.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['page'] = { in: 'query', type: 'integer', default: 1 } */
  /* #swagger.parameters['limit'] = { in: 'query', type: 'integer', default: 10 } */
  /* #swagger.parameters['role'] = { in: 'query', type: 'string', enum: ["USER", "ADMIN"] } */
  /* #swagger.parameters['isActive'] = { in: 'query', type: 'boolean' } */
  /* #swagger.parameters['search'] = { in: 'query', description: 'Search by name or email', type: 'string' } */
  /* #swagger.responses[200] = {
        description: 'Users retrieved successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                results: { type: "integer", example: 1 },
                pagination: {
                  type: "object",
                  properties: {
                    page: { type: "integer", example: 1 },
                    limit: { type: "integer", example: 10 },
                    totalResults: { type: "integer", example: 100 },
                    totalPages: { type: "integer", example: 10 }
                  }
                },
                data: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      fullName: { type: "string" },
                      email: { type: "string" },
                      phoneNumber: { type: "string" },
                      role: { type: "string" },
                      isActive: { type: "boolean" },
                      createdAt: { type: "string", format: "date-time" }
                    }
                  }
                }
              }
            }
          }
        }
     }
  */
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const { role, isActive, search } = req.query;

    const where = {};
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { fullName: { contains: search } },
        { email: { contains: search } }
      ];
    }

    const [users, totalResults] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          fullName: true,
          email: true,
          phoneNumber: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          activityLogs: {
            orderBy: { createdAt: 'desc' },
            take: 10
          }
        }
      }),
      prisma.user.count({ where })
    ]);

    const totalPages = Math.ceil(totalResults / limit);

    res.status(200).json({
      success: true,
      results: users.length,
      pagination: {
        page,
        limit,
        totalResults,
        totalPages
      },
      data: users
    });
  } catch (error) {
    console.error('Error in getAllUsers:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while fetching users.', 500));
    }
  }
};

/**
 * Get user by ID
 * GET /api/users/:id
 */
export const getUserById = async (req, res, next) => {
  // #swagger.tags = ['User Management']
  // #swagger.summary = 'Get user by ID'
  // #swagger.description = 'Fetches details of a single user account by its ID.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['id'] = { in: 'path', required: true, type: 'string' } */
  /* #swagger.responses[200] = {
        description: 'User details retrieved successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                data: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    fullName: { type: "string" },
                    email: { type: "string" },
                    phoneNumber: { type: "string" },
                    role: { type: "string" },
                    isActive: { type: "boolean" },
                    createdAt: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          }
        }
     }
  */
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        activityLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!user) {
      throw new AppError('User not found.', 404);
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error in getUserById:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while retrieving user details.', 500));
    }
  }
};

/**
 * Update user details
 * PATCH /api/users/:id
 */
export const updateUser = async (req, res, next) => {
  // #swagger.tags = ['User Management']
  // #swagger.summary = 'Update user details'
  // #swagger.description = 'Updates user account information. If email or phone changes, checks uniqueness. If password is provided, hashes it.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['id'] = { in: 'path', required: true, type: 'string' } */
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        fullName: { type: "string" },
                        email: { type: "string" },
                        phoneNumber: { type: "string" },
                        role: { type: "string", enum: ["USER", "ADMIN"] },
                        password: { type: "string" },
                        isActive: { type: "boolean" }
                    }
                }
            }
        }
     } */
  /* #swagger.responses[200] = {
        description: 'User updated successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string" },
                data: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    fullName: { type: "string" },
                    email: { type: "string" },
                    phoneNumber: { type: "string" },
                    role: { type: "string" },
                    isActive: { type: "boolean" }
                  }
                }
              }
            }
          }
        }
     }
  */
  try {
    const { id } = req.params;
    const { fullName, email, phoneNumber, role, password, isActive } = req.body;

    // Check if the user exists
    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      throw new AppError('User not found.', 404);
    }

    const updateData = {};

    if (fullName) updateData.fullName = fullName;

    if (email && email !== user.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new AppError('Please provide a valid email address.', 400);
      }
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) {
        throw new AppError('Email address is already in use.', 400);
      }
      updateData.email = email;
    }

    if (phoneNumber && phoneNumber !== user.phoneNumber) {
      const existingPhone = await prisma.user.findUnique({ where: { phoneNumber } });
      if (existingPhone) {
        throw new AppError('Phone number is already in use.', 400);
      }
      updateData.phoneNumber = phoneNumber;
    }

    if (role && role !== user.role) {
      // Affiliate and partner accounts are managed from their own screens
      if (!ASSIGNABLE_ROLES.includes(role) || !ASSIGNABLE_ROLES.includes(user.role)) {
        throw new AppError(`Role can only be changed between ${ASSIGNABLE_ROLES.join(' and ')}.`, 400);
      }
      if (id === req.user.id) {
        throw new AppError('You cannot change your own role.', 400);
      }
      updateData.role = role;
    }

    if (isActive !== undefined) {
      if (id === req.user.id && !isActive) {
        throw new AppError('You cannot deactivate your own admin account.', 400);
      }
      updateData.isActive = isActive;
    }

    if (password) {
      if (password.length < 8) {
        throw new AppError('Password must be at least 8 characters long.', 400);
      }
      updateData.password = await bcrypt.hash(password, 12);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        updatedAt: true
      }
    });

    // If deactivated, revoke all active sessions
    if (isActive === false) {
      await prisma.refreshToken.updateMany({
        where: { userId: id },
        data: { isRevoked: true }
      });
    }

    logActivity({
      userId: req.user.id,
      action: 'USER_UPDATED',
      details: { targetUserId: id, targetUserEmail: updatedUser.email },
      req
    });

    res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: updatedUser
    });
  } catch (error) {
    console.error('Error in updateUser:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while updating the user.', 500));
    }
  }
};

/**
 * Update user status (Activate/Deactivate)
 * PATCH /api/users/:id/status
 */
export const updateUserStatus = async (req, res, next) => {
  // #swagger.tags = ['User Management']
  // #swagger.summary = 'Activate or deactivate a user account'
  // #swagger.description = 'Updates the isActive flag for the specified user account. Deactivating a user revokes all their active sessions immediately.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['id'] = {
        in: 'path',
        description: 'User ID',
        required: true,
        type: 'string'
     } */
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        isActive: { type: "boolean", example: false }
                    },
                    required: ["isActive"]
                }
            }
        }
     } */
  /* #swagger.responses[200] = {
        description: 'User status updated successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string", example: "User account has been deactivated successfully." },
                data: {
                  type: "object",
                  properties: {
                    id: { type: "string", example: "user-uuid-1234" },
                    fullName: { type: "string", example: "John Doe" },
                    email: { type: "string", example: "john@example.com" },
                    isActive: { type: "boolean", example: false },
                    updatedAt: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          }
        }
     }
  */
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      throw new AppError('isActive status must be a boolean value (true or false).', 400);
    }

    // Check if the user exists
    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      throw new AppError('User not found.', 404);
    }

    // Prevent an admin from deactivating their own account
    if (id === req.user.id && !isActive) {
      throw new AppError('You cannot deactivate your own admin account.', 400);
    }

    // Update the user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        updatedAt: true
      }
    });

    // If deactivated, revoke all their active refresh tokens
    if (!isActive) {
      await prisma.refreshToken.updateMany({
        where: { userId: id },
        data: { isRevoked: true }
      });
    }

    // Log this admin activity
    logActivity({
      userId: req.user.id,
      action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      details: { targetUserId: id, targetUserEmail: updatedUser.email },
      req
    });

    res.status(200).json({
      success: true,
      message: `User account has been ${isActive ? 'activated' : 'deactivated'} successfully.`,
      data: updatedUser
    });
  } catch (error) {
    console.error('Error in updateUserStatus:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while updating user status.', 500));
    }
  }
};

/**
 * Delete a user
 * DELETE /api/users/:id
 */
export const deleteUser = async (req, res, next) => {
  // #swagger.tags = ['User Management']
  // #swagger.summary = 'Delete a user'
  // #swagger.description = 'Permanently deletes a user account. Admins cannot delete themselves.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['id'] = { in: 'path', required: true, type: 'string' } */
  /* #swagger.responses[200] = {
        description: 'User deleted successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string" }
              }
            }
          }
        }
     }
  */
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      throw new AppError('You cannot delete your own admin account.', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      throw new AppError('User not found.', 404);
    }

    // Clean up associated affiliate profile first to prevent orphaned records if FK constraints aren't cascading in MySQL
    await prisma.affiliateProfile.deleteMany({
      where: { userId: id }
    });

    await prisma.user.delete({
      where: { id }
    });

    logActivity({
      userId: req.user.id,
      action: 'USER_DELETED',
      details: { targetUserId: id, targetUserEmail: user.email },
      req
    });

    res.status(200).json({
      success: true,
      message: 'User account has been deleted successfully.'
    });
  } catch (error) {
    console.error('Error in deleteUser:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while deleting the user.', 500));
    }
  }
};
