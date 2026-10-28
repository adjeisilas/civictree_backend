import { prisma } from '../../config/config.js';
import { VOUCHER_TYPES } from '../../utils/voucher/voucherTypes.js';
import { AppError } from '../../utils/error/AppError.js';

/**
 * Retrieve aggregated statistics for the admin reports page (last 6 months rolling).
 * GET /api/admin/reports/stats
 */
export const getReportStats = async (req, res, next) => {
  // #swagger.tags = ['Admin - Reports']
  // #swagger.summary = 'Get Admin Report Statistics'
  // #swagger.description = 'Generates aggregated report statistics over a rolling 6-month period, including monthly revenue by exam type, success vs failure rates, and customer acquisition splits (new vs returning).'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Report statistics generated successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        data: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    month: { type: "string", example: "Jan" },
                                    year: { type: "integer", example: 2026 },
                                    revenue: {
                                        type: "object",
                                        properties: {
                                            WASSCE_NOVDEC: { type: "number", example: 3300.00 },
                                            BECE: { type: "number", example: 1000.00 }
                                        }
                                    },
                                    orderRates: {
                                        type: "object",
                                        properties: {
                                            successRate: { type: "number", example: 85.5 },
                                            failureRate: { type: "number", example: 12.3 }
                                        }
                                    },
                                    customers: {
                                        type: "object",
                                        properties: {
                                            new: { type: "integer", example: 150 },
                                            returning: { type: "integer", example: 75 }
                                        }
                                    },
                                    channels: {
                                        type: "object",
                                        properties: {
                                            WEB: { type: "integer", example: 80 },
                                            USSD: { type: "integer", example: 40 }
                                        }
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
    const today = new Date();
    const monthsList = [];

    // Construct the last 6 months list (index 0 is 5 months ago, index 5 is the current month)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      monthsList.push({
        name: d.toLocaleString('default', { month: 'short' }),
        year: d.getFullYear(),
        monthIndex: d.getMonth()
      });
    }

    const startDate = new Date(monthsList[0].year, monthsList[0].monthIndex, 1);

    // 1. Fetch all orders from the start of the 6-month window
    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate
        }
      },
      select: {
        amount: true,
        voucherType: true,
        paymentStatus: true,
        phoneNumber: true,
        createdAt: true
      }
    });

    // 2. Fetch the first order date for all customers involved in these orders
    const phoneNumbers = [...new Set(orders.map(o => o.phoneNumber))];
    let firstOrderDates = {};

    if (phoneNumbers.length > 0) {
      const customerFirstOrders = await prisma.order.groupBy({
        by: ['phoneNumber'],
        _min: {
          createdAt: true
        },
        where: {
          phoneNumber: { in: phoneNumbers }
        }
      });

      for (const row of customerFirstOrders) {
        firstOrderDates[row.phoneNumber] = row._min.createdAt;
      }
    }

    // 3. Process calculations for each month
    const data = monthsList.map(m => {
      const monthOrders = orders.filter(o => 
        o.createdAt.getMonth() === m.monthIndex && 
        o.createdAt.getFullYear() === m.year
      );

      // A. Revenue breakdown (Successful orders only)
      const successfulOrders = monthOrders.filter(o => o.paymentStatus === 'SUCCESS');
      const revenueByType = Object.fromEntries(
        VOUCHER_TYPES.map((type) => [
          type,
          Number(
            successfulOrders
              .filter(o => o.voucherType === type)
              .reduce((sum, o) => sum + Number(o.amount), 0)
              .toFixed(2)
          )
        ])
      );

      // B. Success vs Failure rate trends
      const total = monthOrders.length;
      const successCount = monthOrders.filter(o => o.paymentStatus === 'SUCCESS').length;
      const failedCount = monthOrders.filter(o => o.paymentStatus === 'FAILED').length;
      const successRate = total > 0 ? Number(((successCount / total) * 100).toFixed(1)) : 0.0;
      const failureRate = total > 0 ? Number(((failedCount / total) * 100).toFixed(1)) : 0.0;

      // C. New vs Returning customers (acquisition vs retention)
      const uniquePhonesInMonth = [...new Set(monthOrders.map(o => o.phoneNumber))];
      let newCustomers = 0;
      let returningCustomers = 0;

      for (const phone of uniquePhonesInMonth) {
        const firstOrderDate = firstOrderDates[phone];
        if (firstOrderDate) {
          const monthStart = new Date(m.year, m.monthIndex, 1);
          if (firstOrderDate >= monthStart) {
            newCustomers++;
          } else {
            returningCustomers++;
          }
        }
      }

      // D. Channel metrics (order counts per channel)
      const webOrders = monthOrders.filter(o => o.channel === 'WEB').length;
      const ussdOrders = monthOrders.filter(o => o.channel === 'USSD').length;

      return {
        month: m.name,
        year: m.year,
        revenue: revenueByType,
        orderRates: {
          successRate,
          failureRate
        },
        customers: {
          new: newCustomers,
          returning: returningCustomers
        },
        channels: {
          WEB: webOrders,
          USSD: ussdOrders
        }
      };
    });

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error in getReportStats:', error);
    next(new AppError('An unexpected error occurred while generating report statistics.', 500));
  }
};
