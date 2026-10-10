import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';

/**
 * Get all activity logs (Paginated)
 * GET /api/activity-logs
 */
export const getAllActivityLogs = async (req, res, next) => {
  // #swagger.tags = ['Activity Log']
  // #swagger.summary = 'Get all activity logs (Paginated)'
  // #swagger.description = 'Fetches all user and system activity logs. Supports pagination and optional filtering by userId or action.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['page'] = {
        in: 'query',
        description: 'Page number (default: 1)',
        type: 'integer',
        default: 1
     } */
  /* #swagger.parameters['limit'] = {
        in: 'query',
        description: 'Number of items per page (default: 10)',
        type: 'integer',
        default: 10
     } */
  /* #swagger.parameters['userId'] = {
        in: 'query',
        description: 'Filter logs by user ID',
        type: 'string'
     } */
  /* #swagger.parameters['action'] = {
        in: 'query',
        description: 'Filter logs by action name',
        type: 'string'
     } */
  /* #swagger.responses[200] = {
        description: 'Activity logs retrieved successfully',
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
                      id: { type: "string", example: "39478f7e-7a93-41c3-8e9a-5e72d2fb4b18" },
                      userId: { type: "string", example: "user-uuid-1234" },
                      action: { type: "string", example: "USER_LOGIN" },
                      details: { type: "string", example: '{"email":"user@example.com"}' },
                      ipAddress: { type: "string", example: "127.0.0.1" },
                      userAgent: { type: "string", example: "Mozilla/5.0..." },
                      createdAt: { type: "string", format: "date-time", example: "2026-06-07T12:00:00.000Z" }
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

    const { userId, action } = req.query;

    const where = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;

    const [logs, totalResults] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          }
        }
      }),
      prisma.activityLog.count({ where })
    ]);

    const totalPages = Math.ceil(totalResults / limit);

    res.status(200).json({
      success: true,
      results: logs.length,
      pagination: {
        page,
        limit,
        totalResults,
        totalPages
      },
      data: logs
    });
  } catch (error) {
    console.error('Error in getAllActivityLogs:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while retrieving activity logs.', 500));
    }
  }
};

/**
 * Get activity log by ID
 * GET /api/activity-logs/:id
 */
export const getActivityLogById = async (req, res, next) => {
  // #swagger.tags = ['Activity Log']
  // #swagger.summary = 'Get activity log by ID'
  // #swagger.description = 'Fetches details of a single activity log by its ID.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['id'] = {
        in: 'path',
        description: 'Activity Log ID',
        required: true,
        type: 'string'
     } */
  /* #swagger.responses[200] = {
        description: 'Activity log retrieved successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                data: {
                  type: "object",
                  properties: {
                    id: { type: "string", example: "39478f7e-7a93-41c3-8e9a-5e72d2fb4b18" },
                    userId: { type: "string", example: "user-uuid-1234" },
                    action: { type: "string", example: "USER_LOGIN" },
                    details: { type: "string", example: '{"email":"user@example.com"}' },
                    ipAddress: { type: "string", example: "127.0.0.1" },
                    userAgent: { type: "string", example: "Mozilla/5.0..." },
                    createdAt: { type: "string", format: "date-time", example: "2026-06-07T12:00:00.000Z" },
                    user: {
                      type: "object",
                      properties: {
                        id: { type: "string", example: "user-uuid-1234" },
                        fullName: { type: "string", example: "John Doe" },
                        email: { type: "string", example: "user@example.com" }
                      }
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
    const { id } = req.params;

    const log = await prisma.activityLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    if (!log) {
      throw new AppError('Activity log not found.', 404);
    }

    res.status(200).json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error('Error in getActivityLogById:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while retrieving the activity log.', 500));
    }
  }
};
