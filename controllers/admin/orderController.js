import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { verifyOrderPayment } from '../../utils/payment/verifyOrderPayment.js';
import { applyPaymentVerification } from '../public/orderController.js';

/**
 * Helper to parse various date range formats and query params into Prisma createdAt filter
 */
const parseDateFilter = (query) => {
  const {
    dateRange,
    timeframe,
    filterDate,
    startDate,
    endDate,
    from,
    to,
    dateFrom,
    dateTo,
    date
  } = query;

  // 1. Explicit start and end date range (e.g. from calendar picker)
  const explicitStart = startDate || from || dateFrom;
  const explicitEnd = endDate || to || dateTo;

  if (explicitStart || explicitEnd) {
    const createdAtClause = {};
    if (explicitStart) {
      const s = new Date(explicitStart);
      if (!isNaN(s.getTime())) {
        if (typeof explicitStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(explicitStart.trim())) {
          createdAtClause.gte = new Date(`${explicitStart.trim()}T00:00:00.000Z`);
        } else {
          createdAtClause.gte = s;
        }
      }
    }
    if (explicitEnd) {
      const e = new Date(explicitEnd);
      if (!isNaN(e.getTime())) {
        if (typeof explicitEnd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(explicitEnd.trim())) {
          createdAtClause.lte = new Date(`${explicitEnd.trim()}T23:59:59.999Z`);
        } else {
          createdAtClause.lte = e;
        }
      }
    }
    if (createdAtClause.gte || createdAtClause.lte) {
      return { createdAt: createdAtClause };
    }
  }

  // 2. Single specific date selected
  const singleDate = date || (typeof dateRange === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateRange.trim()) ? dateRange.trim() : null);
  if (singleDate) {
    const dStr = singleDate.trim();
    return {
      createdAt: {
        gte: new Date(`${dStr}T00:00:00.000Z`),
        lte: new Date(`${dStr}T23:59:59.999Z`)
      }
    };
  }

  // 3. Range string or presets ("Today", "This Week", "This Month", etc.)
  const rawRange = dateRange || timeframe || filterDate;
  if (rawRange && typeof rawRange === 'string') {
    const cleanRange = rawRange.trim();

    // Check delimited range strings like "2026-09-01 to 2026-09-02" or "2026-09-01,2026-09-02"
    const separators = [' to ', ' - ', ',', '_', '|'];
    for (const sep of separators) {
      if (cleanRange.includes(sep)) {
        const parts = cleanRange.split(sep).map(p => p.trim());
        if (parts.length === 2) {
          const s = new Date(parts[0]);
          const e = new Date(parts[1]);
          if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
            const startIso = /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) ? `${parts[0]}T00:00:00.000Z` : s.toISOString();
            const endIso = /^\d{4}-\d{2}-\d{2}$/.test(parts[1]) ? `${parts[1]}T23:59:59.999Z` : e.toISOString();
            return {
              createdAt: {
                gte: new Date(startIso),
                lte: new Date(endIso)
              }
            };
          }
        }
      }
    }

    const norm = cleanRange.toLowerCase().replace(/[\s_-]+/g, '');

    if (['all', 'alltime', 'any', 'none', ''].includes(norm)) {
      return {};
    }

    const now = new Date();
    const accraFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Accra',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const todayStr = accraFormatter.format(now); // YYYY-MM-DD
    const todayParts = todayStr.split('-').map(Number);
    const todayMidnight = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2], 0, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2], 23, 59, 59, 999));

    if (norm === 'today') {
      return {
        createdAt: {
          gte: todayMidnight,
          lte: todayEnd
        }
      };
    }

    if (norm === 'yesterday') {
      const yesterdayStart = new Date(todayMidnight);
      yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
      const yesterdayEnd = new Date(todayEnd);
      yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() - 1);
      return {
        createdAt: {
          gte: yesterdayStart,
          lte: yesterdayEnd
        }
      };
    }

    if (['thisweek', 'week', 'currentweek'].includes(norm)) {
      const dayOfWeek = todayMidnight.getUTCDay(); // 0 is Sunday
      const weekStart = new Date(todayMidnight);
      weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek);
      return {
        createdAt: {
          gte: weekStart,
          lte: todayEnd
        }
      };
    }

    if (['lastweek', 'previousweek'].includes(norm)) {
      const dayOfWeek = todayMidnight.getUTCDay();
      const lastWeekEnd = new Date(todayMidnight);
      lastWeekEnd.setUTCDate(lastWeekEnd.getUTCDate() - dayOfWeek - 1);
      lastWeekEnd.setUTCHours(23, 59, 59, 999);
      const lastWeekStart = new Date(lastWeekEnd);
      lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 6);
      lastWeekStart.setUTCHours(0, 0, 0, 0);
      return {
        createdAt: {
          gte: lastWeekStart,
          lte: lastWeekEnd
        }
      };
    }

    if (['thismonth', 'month', 'currentmonth'].includes(norm)) {
      const monthStart = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, 1, 0, 0, 0, 0));
      return {
        createdAt: {
          gte: monthStart,
          lte: todayEnd
        }
      };
    }

    if (['lastmonth', 'previousmonth'].includes(norm)) {
      const lastMonthStart = new Date(Date.UTC(todayParts[0], todayParts[1] - 2, 1, 0, 0, 0, 0));
      const lastMonthEnd = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, 0, 23, 59, 59, 999));
      return {
        createdAt: {
          gte: lastMonthStart,
          lte: lastMonthEnd
        }
      };
    }

    if (['last7days', '7days', '7d'].includes(norm)) {
      const past7Days = new Date(todayMidnight);
      past7Days.setUTCDate(past7Days.getUTCDate() - 6);
      return {
        createdAt: {
          gte: past7Days,
          lte: todayEnd
        }
      };
    }

    if (['last30days', '30days', '30d'].includes(norm)) {
      const past30Days = new Date(todayMidnight);
      past30Days.setUTCDate(past30Days.getUTCDate() - 29);
      return {
        createdAt: {
          gte: past30Days,
          lte: todayEnd
        }
      };
    }

    if (['thisyear', 'year', 'currentyear'].includes(norm)) {
      const yearStart = new Date(Date.UTC(todayParts[0], 0, 1, 0, 0, 0, 0));
      return {
        createdAt: {
          gte: yearStart,
          lte: todayEnd
        }
      };
    }
  }

  return {};
};

/**
 * Controller for listing orders with comprehensive filtering, date range support, and pagination.
 */
export const getOrders = async (req, res, next) => {
  // #swagger.tags = ['Admin - Orders']
  // #swagger.summary = 'List all orders (Admin)'
  // #swagger.description = 'Retrieves a paginated list of purchase orders filtered by search term, channel, category, payment status, delivery status, and calendar date ranges.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['page'] = { in: 'query', description: 'Page number (default: 1)', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Items per page or all for unlimited', type: 'string' }
     #swagger.parameters['q'] = { in: 'query', description: 'Search by Order ID, Customer Name, or Phone Number', type: 'string' }
     #swagger.parameters['voucherType'] = { in: 'query', description: 'Filter by voucher type (BECE, WASSCE_NOVDEC, or All Categories)', type: 'string' }
     #swagger.parameters['paymentStatus'] = { in: 'query', description: 'Filter by payment status (SUCCESS, PENDING, FAILED, or All Payments)', type: 'string' }
     #swagger.parameters['deliveryStatus'] = { in: 'query', description: 'Filter by SMS delivery status (SENT, NOT_SENT, FAILED, or All Deliveries)', type: 'string' }
     #swagger.parameters['channel'] = { in: 'query', description: 'Filter by purchase channel (WEB, USSD)', type: 'string' }
     #swagger.parameters['dateRange'] = { in: 'query', description: 'Date range preset (All Time, Today, This Week, This Month, Yesterday, Last 7 Days, Last 30 Days) or date string', type: 'string' }
     #swagger.parameters['startDate'] = { in: 'query', description: 'Calendar picker start date (YYYY-MM-DD)', type: 'string' }
     #swagger.parameters['endDate'] = { in: 'query', description: 'Calendar picker end date (YYYY-MM-DD)', type: 'string' }
     #swagger.parameters['date'] = { in: 'query', description: 'Single calendar date filter (YYYY-MM-DD)', type: 'string' }
  */
  try {
    const { 
      page = 1, 
      limit = 10, 
      q, 
      search,
      query: searchQuery,
      voucherType, 
      examCategory,
      paymentStatus, 
      deliveryStatus, 
      smsDeliveryStatus,
      channel 
    } = req.query;

    const isNoLimit = limit === 'all' || limit === 'none' || limit === '0' || limit === 0 || limit === '-1' || limit === -1;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = isNoLimit ? undefined : (parseInt(limit, 10) || 10);
    const skip = isNoLimit ? undefined : (pageNum - 1) * limitNum;

    // 1. Search query filter (Order ID, Customer Name, Phone Number)
    const searchTerm = (q || search || searchQuery || '').trim();
    const searchClause = searchTerm ? {
      OR: [
        { id: { contains: searchTerm } },
        { customerName: { contains: searchTerm } },
        { phoneNumber: { contains: searchTerm } }
      ]
    } : {};

    // 2. Comprehensive Date range filter
    const dateClause = parseDateFilter(req.query);

    // 3. Normalize Voucher / Category Filter
    let normVoucherType;
    const rawVoucherType = voucherType || examCategory;
    if (rawVoucherType) {
      const vt = rawVoucherType.trim().toUpperCase().replace(/\s+/g, '_');
      if (!['ALL', 'ALL_CATEGORIES', 'ALL_TYPES', 'ALL_VOUCHERS', 'NONE', ''].includes(vt)) {
        if (vt.includes('WASSCE') || vt.includes('NOVDEC')) normVoucherType = 'WASSCE_NOVDEC';
        else if (vt.includes('BECE')) normVoucherType = 'BECE';
        else normVoucherType = vt;
      }
    }

    // 4. Normalize Payment Status Filter
    let normPaymentStatus;
    if (paymentStatus) {
      const ps = paymentStatus.trim().toUpperCase().replace(/\s+/g, '_');
      if (!['ALL', 'ALL_PAYMENTS', 'ALL_STATUS', 'NONE', ''].includes(ps)) {
        if (['PAID', 'SUCCESS', 'SUCCESSFUL'].includes(ps)) normPaymentStatus = 'SUCCESS';
        else if (['UNPAID', 'PENDING'].includes(ps)) normPaymentStatus = 'PENDING';
        else if (['FAILED', 'FAIL'].includes(ps)) normPaymentStatus = 'FAILED';
        else normPaymentStatus = ps;
      }
    }

    // 5. Normalize Delivery Status Filter
    let normDeliveryStatus;
    const rawDeliveryStatus = deliveryStatus || smsDeliveryStatus;
    if (rawDeliveryStatus) {
      const ds = rawDeliveryStatus.trim().toUpperCase().replace(/\s+/g, '_');
      if (!['ALL', 'ALL_DELIVERIES', 'ALL_STATUS', 'NONE', ''].includes(ds)) {
        if (['SENT', 'DELIVERED'].includes(ds)) normDeliveryStatus = 'SENT';
        else if (['NOT_SENT', 'UNSENT', 'PENDING'].includes(ds)) normDeliveryStatus = 'NOT_SENT';
        else if (['FAILED', 'FAIL'].includes(ds)) normDeliveryStatus = 'FAILED';
        else normDeliveryStatus = ds;
      }
    }

    // 6. Normalize Channel Filter
    let normChannel;
    if (channel) {
      const ch = channel.trim().toUpperCase().replace(/\s+/g, '_');
      if (!['ALL', 'ALL_CHANNELS', 'NONE', ''].includes(ch)) {
        if (ch.includes('USSD')) normChannel = 'USSD';
        else if (ch.includes('WEB')) normChannel = 'WEB';
        else normChannel = ch;
      }
    }

    // Combined query criteria
    const where = {
      ...searchClause,
      ...dateClause,
      ...(normVoucherType ? { voucherType: normVoucherType } : {}),
      ...(normPaymentStatus ? { paymentStatus: normPaymentStatus } : {}),
      ...(normDeliveryStatus ? { deliveryStatus: normDeliveryStatus } : {}),
      ...(normChannel ? { channel: normChannel } : {})
    };

    // Query both total count and records in parallel
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          vouchers: {
            select: {
              id: true,
              serialNumber: true,
              status: true
            }
          }
        }
      }),
      prisma.order.count({ where })
    ]);

    return res.status(200).json({
      success: true,
      message: 'Orders retrieved successfully.',
      data: {
        orders,
        pagination: {
          total,
          page: isNoLimit ? 1 : pageNum,
          limit: isNoLimit ? total : limitNum,
          totalPages: isNoLimit ? 1 : (Math.ceil(total / limitNum) || 1)
        }
      }
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to retrieve orders.', 500));
  }
};

/**
 * Controller for retrieving details of a single order by ID.
 */
export const getOrderById = async (req, res, next) => {
  // #swagger.tags = ['Admin - Orders']
  // #swagger.summary = 'Get order by ID (Admin)'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        vouchers: true
      }
    });

    if (!order) {
      throw new AppError(`Order with ID ${id} not found.`, 404);
    }

    return res.status(200).json({
      success: true,
      message: 'Order details retrieved successfully.',
      data: order
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError(error.message || 'Failed to retrieve order details.', 500));
    }
  }
};

/**
 * Controller for generating aggregated order statistics with optional date filtering.
 */
export const getOrderStats = async (req, res, next) => {
  // #swagger.tags = ['Admin - Orders']
  // #swagger.summary = 'Get Order Statistics (Admin)'
  // #swagger.description = 'Retrieves aggregated order stats filtered by preset or calendar date ranges.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['dateRange'] = { in: 'query', description: 'Date range preset (All Time, Today, This Week, This Month, Yesterday, Last 7 Days, Last 30 Days)', type: 'string' }
     #swagger.parameters['startDate'] = { in: 'query', description: 'Calendar picker start date (YYYY-MM-DD)', type: 'string' }
     #swagger.parameters['endDate'] = { in: 'query', description: 'Calendar picker end date (YYYY-MM-DD)', type: 'string' }
     #swagger.parameters['date'] = { in: 'query', description: 'Single calendar date filter (YYYY-MM-DD)', type: 'string' }
  */
  try {
    const dateClause = parseDateFilter(req.query);

    // 1. Calculate Completed Payment Aggregates (Revenue, counts)
    const completedAggregates = await prisma.order.aggregate({
      where: { paymentStatus: 'SUCCESS', ...dateClause },
      _sum: {
        amount: true,
        quantity: true
      },
      _count: {
        id: true
      }
    });

    const totalRevenue = completedAggregates._sum.amount || 0;
    const totalVouchersSold = completedAggregates._sum.quantity || 0;
    const totalCompletedOrders = completedAggregates._count.id || 0;

    const [
      totalOrders,
      totalOrdersSuccessful,
      totalOrdersPending,
      totalOrdersFailed
    ] = await Promise.all([
      prisma.order.count({ where: { ...dateClause } }),
      prisma.order.count({ where: { paymentStatus: 'SUCCESS', ...dateClause } }),
      prisma.order.count({ where: { paymentStatus: 'PENDING', ...dateClause } }),
      prisma.order.count({ where: { paymentStatus: 'FAILED', ...dateClause } })
    ]);

    // 2. Voucher type breakdown for completed orders
    const typeGroups = await prisma.order.groupBy({
      by: ['voucherType'],
      where: { paymentStatus: 'SUCCESS', ...dateClause },
      _sum: {
        quantity: true,
        amount: true
      }
    });

    // 3. Payment channel breakdown for completed orders
    const channelGroups = await prisma.order.groupBy({
      by: ['channel'],
      where: { paymentStatus: 'SUCCESS', ...dateClause },
      _count: {
        id: true
      }
    });

    // 4. Delivery status breakdown for completed orders
    const deliveryGroups = await prisma.order.groupBy({
      by: ['deliveryStatus'],
      where: { paymentStatus: 'SUCCESS', ...dateClause },
      _count: {
        id: true
      }
    });

    // Structure response data logically
    const stats = {
      summary: {
        totalRevenue: Number(totalRevenue),
        totalVouchersSold,
        totalCompletedOrders,
        totalOrders,
        totalOrdersSuccessful,
        totalOrdersPending,
        totalOrdersFailed
      },
      byVoucherType: {
        WASSCE_NOVDEC: typeGroups.find(g => g.voucherType === 'WASSCE_NOVDEC')?._sum.quantity || 0,
        BECE: typeGroups.find(g => g.voucherType === 'BECE')?._sum.quantity || 0
      },
      byChannel: {
        WEB: channelGroups.find(g => g.channel === 'WEB')?._count.id || 0,
        USSD: channelGroups.find(g => g.channel === 'USSD')?._count.id || 0
      },
      deliverySuccessRate: {
        SENT: deliveryGroups.find(g => g.deliveryStatus === 'SENT')?._count.id || 0,
        FAILED: deliveryGroups.find(g => g.deliveryStatus === 'FAILED')?._count.id || 0,
        NOT_SENT: deliveryGroups.find(g => g.deliveryStatus === 'NOT_SENT')?._count.id || 0
      }
    };

    return res.status(200).json({
      success: true,
      message: 'Order statistics generated successfully.',
      data: stats
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to retrieve order statistics.', 500));
  }
};

/**
 * Controller for manually triggering/verifying Hubtel payment status of a pending order.
 */
export const verifyOrderPaymentStatus = async (req, res, next) => {
  // #swagger.tags = ['Admin - Orders']
  // #swagger.summary = 'Manually verify and synchronize order payment status (Admin)'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id }
    });

    if (!order) {
      throw new AppError(`Order with ID ${id} not found.`, 404);
    }

    if (order.paymentStatus === 'SUCCESS') {
      return res.status(200).json({
        success: true,
        message: 'Order is already marked as paid.',
        data: order
      });
    }

    if (order.paymentStatus !== 'PENDING') {
      return res.status(200).json({
        success: false,
        message: `Order is marked as ${order.paymentStatus} and cannot be re-verified.`,
        data: order
      });
    }

    // Hubtel reports a paid order as 'Paid'; the shared verifier also checks the amount
    const verification = await verifyOrderPayment(order);
    const result = await applyPaymentVerification({
      order,
      verification,
      req,
      source: 'ADMIN_VERIFY'
    });

    logActivity({
      userId: req.user.id,
      action: 'ADMIN_ORDER_PAYMENT_VERIFIED',
      details: { orderId: order.id, verification: verification.outcome, paymentStatus: result.paymentStatus },
      req
    });

    if (result.paymentStatus === 'SUCCESS') {
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id }
      });

      return res.status(200).json({
        success: true,
        message: 'Order payment status verified and updated to SUCCESS.',
        data: updatedOrder
      });
    }

    return res.status(200).json({
      success: false,
      message: 'Payment verification checked with provider. Payment has not been completed.',
      data: {
        orderId: order.id,
        currentStatus: result.paymentStatus,
        providerStatus: verification.outcome,
        providerMessage: result.message
      }
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to verify order payment status.', 500));
  }
};
