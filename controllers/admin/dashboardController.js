import { prisma } from '../../config/config.js';
import { VOUCHER_TYPES, stockLimitFrom, zeroedByType } from '../../utils/voucher/voucherTypes.js';
import { AppError } from '../../utils/error/AppError.js';

/**
 * Retrieve comprehensive statistics and reporting data for the admin dashboard.
 * GET /api/admin/dashboard/stats
 */
export const getDashboardStats = async (req, res, next) => {
  // #swagger.tags = ['Admin - Dashboard']
  // #swagger.summary = 'Get Admin Dashboard Statistics'
  // #swagger.description = 'Generates comprehensive statistics and metrics for the main admin dashboard, including financial summaries, stock allocations, channel splits, monthly revenue trends, and recent activities.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Dashboard statistics generated successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        data: {
                            type: "object",
                            properties: {
                                totalRevenue: { type: "number", example: 15450.50 },
                                totalOrders: { type: "integer", example: 120 },
                                totalSuccessfulOrders: { type: "integer", example: 100 },
                                totalFailedOrders: { type: "integer", example: 15 },
                                totalPendingOrders: { type: "integer", example: 5 },
                                totalVoucherStock: { type: "integer", example: 430 },
                                totalCustomers: { type: "integer", example: 45 },
                                totalSmsDelivered: { type: "integer", example: 95 },
                                averageOrderValue: { type: "number", example: 154.51 },
                                revenueTrends: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            month: { type: "string", example: "Jan" },
                                            revenue: { type: "number", example: 1200.00 }
                                        }
                                    }
                                },
                                 voucherSalesCountByType: {
                                    type: "object",
                                    properties: {
                                        WASSCE_NOVDEC: { type: "integer", example: 65 },
                                        BECE: { type: "integer", example: 35 }
                                    }
                                },
                                ordersCountByChannel: {
                                    type: "object",
                                    properties: {
                                        WEB: { type: "integer", example: 80 },
                                        USSD: { type: "integer", example: 40 }
                                    }
                                },
                                dailyOrdersCount: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            day: { type: "string", example: "Sun" },
                                            count: { type: "integer", example: 10 }
                                        }
                                    }
                                },
                                recentOrders: { type: "array", items: { type: "object" } },
                                voucherStockStatus: { type: "object" },
                                recentActivityLogs: { type: "array", items: { type: "object" } }
                            }
                        }
                    }
                }
            }
        }
     }
  */
  try {
    // 1. Core aggregates
    const successfulOrdersAggregate = await prisma.order.aggregate({
      where: { paymentStatus: 'SUCCESS' },
      _sum: {
        amount: true,
        quantity: true
      },
      _count: {
        id: true
      }
    });

    const totalRevenue = Number(successfulOrdersAggregate._sum.amount) || 0;
    const totalSuccessfulOrders = successfulOrdersAggregate._count.id || 0;
    const averageOrderValue = totalSuccessfulOrders > 0 ? Number((totalRevenue / totalSuccessfulOrders).toFixed(2)) : 0;

    const [
      totalOrders,
      totalFailedOrders,
      totalPendingOrders,
      totalVoucherStock,
      totalSmsDelivered
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { paymentStatus: 'FAILED' } }),
      prisma.order.count({ where: { paymentStatus: 'PENDING' } }),
      prisma.voucher.count({ where: { status: 'AVAILABLE' } }),
      prisma.order.count({ where: { deliveryStatus: 'SENT' } })
    ]);

    // Unique customers count (by phone number)
    const uniqueCustomersGroup = await prisma.order.groupBy({
      by: ['phoneNumber']
    });
    const totalCustomers = uniqueCustomersGroup.length;

    // 2. Monthly Revenue Trends (Current Year)
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);

    const successfulOrdersThisYear = await prisma.order.findMany({
      where: {
        paymentStatus: 'SUCCESS',
        createdAt: {
          gte: startOfYear,
          lte: endOfYear
        }
      },
      select: {
        amount: true,
        createdAt: true
      }
    });

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const revenueTrends = months.map((month, index) => {
      const monthlyOrders = successfulOrdersThisYear.filter(o => o.createdAt.getMonth() === index);
      const revenue = monthlyOrders.reduce((sum, o) => sum + Number(o.amount), 0);
      return { month, revenue: Number(revenue.toFixed(2)) };
    });

    // 3. Voucher sales count by type
    const typeSales = await prisma.order.groupBy({
      by: ['voucherType'],
      where: { paymentStatus: 'SUCCESS' },
      _sum: {
        quantity: true
      }
    });

    const voucherSalesCountByType = {
      ...zeroedByType(),
      ...Object.fromEntries(
        VOUCHER_TYPES.map((type) => [
          type,
          typeSales.find((g) => g.voucherType === type)?._sum.quantity || 0
        ])
      )
    };

    // 4. Orders count by channel
    const channelCounts = await prisma.order.groupBy({
      by: ['channel'],
      _count: {
        id: true
      }
    });

    const ordersCountByChannel = {
      WEB: channelCounts.find(g => g.channel === 'WEB')?._count.id || 0,
      USSD: channelCounts.find(g => g.channel === 'USSD')?._count.id || 0
    };

    // 5. Daily orders count for each day of the current week (Sun - Sat)
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const weeklyOrders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startOfWeek,
          lte: endOfWeek
        }
      },
      select: {
        createdAt: true
      }
    });

    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyOrdersCount = daysOfWeek.map((day, index) => {
      const count = weeklyOrders.filter(o => o.createdAt.getDay() === index).length;
      return { day, count };
    });

    // 6. Voucher stock status (refer to the UI spec)
    const config = await prisma.voucherConfig.findFirst();
    // Each type's own low-stock threshold, with the schema default as fallback

    const getStockDetails = async (type, limit) => {
      const available = await prisma.voucher.count({ where: { type, status: 'AVAILABLE' } });
      const sold = await prisma.voucher.count({ where: { type, status: 'SOLD' } });
      const total = available + sold;
      const allocatedPercent = total > 0 ? Number(((sold / total) * 100).toFixed(1)) : 0;
      const remainingPercent = total > 0 ? Number(((available / total) * 100).toFixed(1)) : 0;
      const isLowStock = available <= limit;

      return {
        available,
        sold,
        total,
        allocatedPercent,
        remainingPercent,
        isLowStock
      };
    };

    const voucherStockStatus = {
      ...Object.fromEntries(
        await Promise.all(
          VOUCHER_TYPES.map(async (type) => [
            type,
            await getStockDetails(type, stockLimitFrom(config, type))
          ])
        )
      )
    };

    // 7. First 5 recent orders
    const recentOrders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    // 8. 5 recent activity logs
    const recentActivityLogs = await prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        user: {
          select: {
            fullName: true,
            email: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalOrders,
        totalSuccessfulOrders,
        totalFailedOrders,
        totalPendingOrders,
        totalVoucherStock,
        totalCustomers,
        totalSmsDelivered,
        averageOrderValue,
        revenueTrends,
        voucherSalesCountByType,
        ordersCountByChannel,
        dailyOrdersCount,
        recentOrders,
        voucherStockStatus,
        recentActivityLogs
      }
    });
  } catch (error) {
    console.error('Error in getDashboardStats:', error);
    next(new AppError(error.message || 'An unexpected error occurred while generating dashboard statistics.', 500));
  }
};
