import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';

/**
 * Subscribe to Web Push Notifications
 * POST /api/notifications/push/subscribe
 */
export const subscribePush = async (req, res, next) => {
  // #swagger.tags = ['Notification']
  // #swagger.summary = 'Subscribe to web push notifications'
  // #swagger.description = 'Registers or updates a push subscription for the authenticated user.'
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        endpoint: { type: "string", example: "https://fcm.googleapis.com/fcm/send/..." },
                        keys: {
                            type: "object",
                            properties: {
                                p256dh: { type: "string", example: "BGoB..." },
                                auth: { type: "string", example: "3s..." }
                            },
                            required: ["p256dh", "auth"]
                        }
                    },
                    required: ["endpoint", "keys"]
                }
            }
        }
    } */
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      throw new AppError('Invalid subscription payload. Must include endpoint and keys (p256dh, auth).', 400);
    }

    // Save or update subscription
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: req.user.id,
        p256dh: keys.p256dh,
        auth: keys.auth
      },
      create: {
        userId: req.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth
      }
    });

    res.status(200).json({
      success: true,
      message: 'Push subscription registered successfully',
      data: subscription
    });
  } catch (error) {
    console.error('Error in subscribePush:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while subscribing to push notifications. Please try again.', 500));
    }
  }
};

/**
 * Unsubscribe from Web Push Notifications
 * POST /api/notifications/push/unsubscribe
 */
export const unsubscribePush = async (req, res, next) => {
  // #swagger.tags = ['Notification']
  // #swagger.summary = 'Unsubscribe from web push notifications'
  // #swagger.description = 'Removes a push subscription matching the given endpoint for the authenticated user.'
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        endpoint: { type: "string", example: "https://fcm.googleapis.com/fcm/send/..." }
                    },
                    required: ["endpoint"]
                }
            }
        }
    } */
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      throw new AppError('Endpoint is required to unsubscribe.', 400);
    }

    // Check if subscription exists and belongs to the user
    const existingSub = await prisma.pushSubscription.findFirst({
      where: {
        endpoint,
        userId: req.user.id
      }
    });

    if (!existingSub) {
      throw new AppError('Subscription not found for this user.', 404);
    }

    await prisma.pushSubscription.delete({
      where: { id: existingSub.id }
    });

    res.status(200).json({
      success: true,
      message: 'Push subscription removed successfully'
    });
  } catch (error) {
    console.error('Error in unsubscribePush:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while unsubscribing from push notifications. Please try again.', 500));
    }
  }
};

/**
 * Get all notifications for the authenticated user
 * GET /api/notifications
 */
export const getAllNotifications = async (req, res, next) => {
  // #swagger.tags = ['Notification']
  // #swagger.summary = 'Get all notifications (Paginated & Filterable)'
  // #swagger.description = 'Fetches notifications for the authenticated user with optional filtering by category type (SYSTEM, ORDER, SMS, VOUCHER, LOW_STOCK, AFFILIATE, WITHDRAWAL).'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['page'] = {
        in: 'query',
        description: 'Page number (default: 1)',
        type: 'integer',
        default: 1
     } */
  /* #swagger.parameters['limit'] = {
        in: 'query',
        description: 'Number of notifications per page (default: 10)',
        type: 'integer',
        default: 10
     } */
  /* #swagger.parameters['type'] = {
        in: 'query',
        description: 'Filter by notification category: SYSTEM, ORDER, SMS, VOUCHER, LOW_STOCK, AFFILIATE, WITHDRAWAL',
        type: 'string'
     } */
  /* #swagger.responses[200] = {
        description: 'Notifications retrieved successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                results: { type: "integer", example: 2 },
                pagination: {
                  type: "object",
                  properties: {
                    page: { type: "integer", example: 1 },
                    limit: { type: "integer", example: 10 },
                    totalResults: { type: "integer", example: 2 },
                    totalPages: { type: "integer", example: 1 }
                  }
                },
                data: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", example: "39478f7e-7a93-41c3-8e9a-5e72d2fb4b18" },
                      userId: { type: "string", example: "user-uuid-1234" },
                      title: { type: "string", example: "New Order Placed" },
                      message: { type: "string", example: "Order #CT-1001 was successfully placed." },
                      isRead: { type: "boolean", example: false },
                      type: { 
                        type: "string", 
                        example: "ORDER",
                        enum: ["SYSTEM", "ORDER", "SMS", "VOUCHER", "LOW_STOCK", "AFFILIATE", "WITHDRAWAL"],
                        description: "Notification types: SYSTEM, ORDER, SMS, VOUCHER, LOW_STOCK, AFFILIATE, WITHDRAWAL"
                      },
                      createdAt: { type: "string", format: "date-time", example: "2026-06-07T12:00:00.000Z" },
                      updatedAt: { type: "string", format: "date-time", example: "2026-06-07T12:00:00.000Z" }
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
    const { type } = req.query;

    const where = { userId: req.user.id };
    if (type) {
      where.type = type.trim().toUpperCase();
    }

    const [notifications, totalResults] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.notification.count({ where })
    ]);

    const totalPages = Math.ceil(totalResults / limit);

    res.status(200).json({
      success: true,
      results: notifications.length,
      pagination: {
        page,
        limit,
        totalResults,
        totalPages
      },
      data: notifications
    });
  } catch (error) {
    console.error('Error in getAllNotifications:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while retrieving notifications.', 500));
    }
  }
};

/**
 * Get notification by ID
 * GET /api/notifications/:id
 */
export const getNotificationById = async (req, res, next) => {
  // #swagger.tags = ['Notification']
  // #swagger.summary = 'Get notification by ID'
  // #swagger.description = 'Fetches details of a single notification by its ID. Users can only access their own notifications.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['id'] = {
        in: 'path',
        description: 'Notification ID',
        required: true,
        type: 'string'
     } */
  /* #swagger.responses[200] = {
        description: 'Notification retrieved successfully',
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
                    title: { type: "string", example: "New Message" },
                    message: { type: "string", example: "You have a new message from Support." },
                    isRead: { type: "boolean", example: false },
                    type: { 
                      type: "string", 
                      example: "ORDER", 
                      enum: ["SYSTEM", "ORDER", "SMS", "VOUCHER", "LOW_STOCK", "AFFILIATE", "WITHDRAWAL"],
                      description: "Notification types: SYSTEM, ORDER, SMS, VOUCHER, LOW_STOCK, AFFILIATE, WITHDRAWAL"
                    },
                    createdAt: { type: "string", format: "date-time", example: "2026-06-07T12:00:00.000Z" },
                    updatedAt: { type: "string", format: "date-time", example: "2026-06-07T12:00:00.000Z" }
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

    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification || notification.userId !== req.user.id) {
      throw new AppError('Notification not found or access denied.', 404);
    }

    res.status(200).json({
      success: true,
      data: notification
    });
  } catch (error) {
    console.error('Error in getNotificationById:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while retrieving the notification.', 500));
    }
  }
};

/**
 * Mark a single notification as read
 * PATCH /api/notifications/:id/read
 */
export const markNotificationAsRead = async (req, res, next) => {
  // #swagger.tags = ['Notification']
  // #swagger.summary = 'Mark a notification as read'
  // #swagger.description = 'Updates the read status of a specific notification to true. Users can only update their own notifications.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['id'] = {
        in: 'path',
        description: 'Notification ID',
        required: true,
        type: 'string'
     } */
  /* #swagger.responses[200] = {
        description: 'Notification marked as read successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string", example: "Notification marked as read" },
                data: {
                  type: "object",
                  properties: {
                    id: { type: "string", example: "39478f7e-7a93-41c3-8e9a-5e72d2fb4b18" },
                    userId: { type: "string", example: "user-uuid-1234" },
                    title: { type: "string", example: "New Message" },
                    message: { type: "string", example: "You have a new message from Support." },
                    isRead: { type: "boolean", example: true },
                    type: { 
                      type: "string", 
                      example: "ORDER", 
                      enum: ["SYSTEM", "ORDER", "SMS", "VOUCHER", "LOW_STOCK", "AFFILIATE", "WITHDRAWAL"],
                      description: "Notification types: SYSTEM, ORDER, SMS, VOUCHER, LOW_STOCK, AFFILIATE, WITHDRAWAL"
                    },
                    createdAt: { type: "string", format: "date-time", example: "2026-06-07T12:00:00.000Z" },
                    updatedAt: { type: "string", format: "date-time", example: "2026-06-07T12:00:00.000Z" }
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

    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification || notification.userId !== req.user.id) {
      throw new AppError('Notification not found or access denied.', 404);
    }

    const updatedNotification = await prisma.notification.update({
      where: { id },
      data: { isRead: true }
    });

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: updatedNotification
    });
  } catch (error) {
    console.error('Error in markNotificationAsRead:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while updating the notification status.', 500));
    }
  }
};

/**
 * Mark all notifications for the authenticated user as read
 * PATCH /api/notifications/read-all
 */
export const markAllNotificationsAsRead = async (req, res, next) => {
  // #swagger.tags = ['Notification']
  // #swagger.summary = 'Mark all notifications as read'
  // #swagger.description = 'Updates the read status of all unread notifications for the authenticated user to true.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'All notifications marked as read successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string", example: "All notifications marked as read. Count: 5" }
              }
            }
          }
        }
     }
  */
  try {
    const updateResult = await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
        isRead: false
      },
      data: { isRead: true }
    });

    res.status(200).json({
      success: true,
      message: `All notifications marked as read. Count: ${updateResult.count}`
    });
  } catch (error) {
    console.error('Error in markAllNotificationsAsRead:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while updating notifications status.', 500));
    }
  }
};

/**
 * Get list of all supported notification types and categories
 * GET /api/notifications/types
 */
export const getNotificationTypes = async (req, res, next) => {
  // #swagger.tags = ['Notification']
  // #swagger.summary = 'Get all notification types and categories with unread counts'
  // #swagger.description = 'Retrieves a list of all supported notification types (SYSTEM, ORDER, SMS, VOUCHER, LOW_STOCK, AFFILIATE, WITHDRAWAL) along with the total unread notification count for each type for the authenticated user.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Notification types retrieved successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                totalUnread: { type: "integer", example: 5 },
                data: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", example: "ORDER", enum: ["SYSTEM", "ORDER", "SMS", "VOUCHER", "LOW_STOCK", "AFFILIATE", "WITHDRAWAL"] },
                      name: { type: "string", example: "Order & Payment" },
                      description: { type: "string", example: "Notifications regarding customer orders and payments." },
                      unreadCount: { type: "integer", example: 3 }
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
    // Group unread notifications by type for the authenticated user
    const unreadGrouped = await prisma.notification.groupBy({
      by: ['type'],
      where: {
        userId: req.user.id,
        isRead: false
      },
      _count: {
        _all: true
      }
    });

    // Create a mapping of type -> unread count
    const unreadMap = {};
    let totalUnread = 0;
    unreadGrouped.forEach((group) => {
      if (group.type) {
        unreadMap[group.type] = group._count._all;
        totalUnread += group._count._all;
      }
    });

    const types = [
      { type: 'SYSTEM', name: 'System Alert', description: 'General system notifications and admin alerts.' },
      { type: 'ORDER', name: 'Order & Payment', description: 'Notifications regarding new customer orders and payment statuses.' },
      { type: 'SMS', name: 'SMS Campaign', description: 'Notifications dispatched during SMS campaign executions.' },
      { type: 'VOUCHER', name: 'Voucher Management', description: 'Notifications regarding voucher batch uploads and stock additions.' },
      { type: 'LOW_STOCK', name: 'Low Stock Warning', description: 'Automated warnings when voucher inventory is running low.' },
      { type: 'AFFILIATE', name: 'Affiliate Program', description: 'Notifications regarding affiliate applications, status changes, and commissions.' },
      { type: 'WITHDRAWAL', name: 'Withdrawal & Payout', description: 'Notifications regarding affiliate withdrawal requests and direct admin payouts.' }
    ].map((item) => ({
      ...item,
      unreadCount: unreadMap[item.type] || 0
    }));

    res.status(200).json({
      success: true,
      totalUnread,
      data: types
    });
  } catch (error) {
    console.error('Error in getNotificationTypes:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while fetching notification types.', 500));
    }
  }
};
