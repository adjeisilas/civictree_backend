import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';

/**
 * List all customers (derived from orders) with aggregation, filters, and pagination
 * GET /api/admin/customers
 */
export const getCustomers = async (req, res, next) => {
  // #swagger.tags = ['Customer Management']
  // #swagger.summary = 'List all customers'
  // #swagger.description = 'Retrieves a paginated list of customers aggregated from orders. Supports filtering by channel, voucher type, and search queries (name or phone).'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['page'] = { in: 'query', type: 'integer', default: 1 } */
  /* #swagger.parameters['limit'] = { in: 'query', type: 'integer', default: 10 } */
  /* #swagger.parameters['channel'] = { in: 'query', type: 'string', description: 'Filter by purchase channel (WEB or USSD)' } */
  /* #swagger.parameters['voucherType'] = { in: 'query', type: 'string', description: 'Filter by voucher type (WASSCE_NOVDEC or BECE)' } */
  /* #swagger.parameters['search'] = { in: 'query', type: 'string', description: 'Search by phone number or name' } */
  /* #swagger.responses[200] = {
        description: 'Customers list retrieved successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/CustomerListResponse" }
            }
        }
     }
  */
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const { channel, voucherType, search } = req.query;

    const whereClause = {};

    if (channel) {
      whereClause.channel = channel.toUpperCase();
    }

    if (voucherType) {
      whereClause.voucherType = voucherType.toUpperCase();
    }

    if (search) {
      const searchTerm = search.trim();
      whereClause.OR = [
        { phoneNumber: { contains: searchTerm } },
        { customerName: { contains: searchTerm } }
      ];
    }

    // Get unique phone numbers matching filters
    const countResult = await prisma.order.groupBy({
      by: ['phoneNumber'],
      where: whereClause,
      orderBy: {
        phoneNumber: 'asc'
      }
    });
    const totalResults = countResult.length;
    const totalPages = Math.ceil(totalResults / limit);

    // Fetch paginated groups
    const paginatedGroups = await prisma.order.groupBy({
      by: ['phoneNumber'],
      where: whereClause,
      orderBy: {
        phoneNumber: 'asc'
      },
      skip,
      take: limit
    });

    // Compile customer details for the page
    const customerList = await Promise.all(
      paginatedGroups.map(async (group) => {
        const phone = group.phoneNumber;

        // Fetch all orders for this customer to compile complete profiles
        const orders = await prisma.order.findMany({
          where: { phoneNumber: phone },
          orderBy: { createdAt: 'desc' }
        });

        const latestWithName = orders.find(o => o.customerName && o.customerName.trim() !== '');
        const name = latestWithName ? latestWithName.customerName.trim() : '';

        const totalOrdersCount = orders.length;
        const firstPurchaseDate = orders.length > 0 ? orders[orders.length - 1].createdAt : null;
        const lastPurchasedDate = orders.length > 0 ? orders[0].createdAt : null;

        const usedChannels = Array.from(new Set(orders.map(o => o.channel)));

        const successfulOrders = orders.filter(o => o.paymentStatus === 'SUCCESS');
        const lifetimeSpent = successfulOrders.reduce((sum, o) => sum + Number(o.amount), 0);
        const totalQuantity = successfulOrders.reduce((sum, o) => sum + o.quantity, 0);
        const purchasedVoucherTypes = Array.from(new Set(successfulOrders.map(o => o.voucherType)));

        return {
          phoneNumber: phone,
          name,
          status: 'active',
          totalOrdersCount,
          lifetimeSpent,
          firstPurchaseDate,
          lastPurchasedDate,
          purchasedVoucherTypes,
          usedChannels,
          totalQuantity,
          defaultPaymentChannel: 'hubtel'
        };
      })
    );

    res.status(200).json({
      success: true,
      results: customerList.length,
      pagination: {
        page,
        limit,
        totalResults,
        totalPages
      },
      data: customerList
    });
  } catch (error) {
    console.error('Error in getCustomers:', error);
    next(new AppError('An unexpected error occurred while fetching customers.', 500));
  }
};

/**
 * Retrieve customer details and order history by phone number
 * GET /api/admin/customers/:phoneNumber
 */
export const getCustomerByPhoneNumber = async (req, res, next) => {
  // #swagger.tags = ['Customer Management']
  // #swagger.summary = 'Get customer profile and history'
  // #swagger.description = 'Fetches detailed stats and order history of a customer by their phone number.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Customer profile and order history retrieved successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        data: {
                            type: "object",
                            properties: {
                                profile: { $ref: "#/components/schemas/CustomerProfile" },
                                orders: {
                                    type: "array",
                                    items: { $ref: "#/components/schemas/Order" }
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
    const { phoneNumber } = req.params;

    // Fetch all orders for this phoneNumber
    const orders = await prisma.order.findMany({
      where: { phoneNumber },
      orderBy: { createdAt: 'desc' },
      include: { vouchers: true }
    });

    if (orders.length === 0) {
      throw new AppError('Customer not found.', 404);
    }

    const latestWithName = orders.find(o => o.customerName && o.customerName.trim() !== '');
    const name = latestWithName ? latestWithName.customerName.trim() : '';

    const totalOrdersCount = orders.length;
    const firstPurchaseDate = orders.length > 0 ? orders[orders.length - 1].createdAt : null;
    const lastPurchasedDate = orders.length > 0 ? orders[0].createdAt : null;

    const usedChannels = Array.from(new Set(orders.map(o => o.channel)));

    const successfulOrders = orders.filter(o => o.paymentStatus === 'SUCCESS');
    const lifetimeSpent = successfulOrders.reduce((sum, o) => sum + Number(o.amount), 0);
    const totalQuantity = successfulOrders.reduce((sum, o) => sum + o.quantity, 0);
    const purchasedVoucherTypes = Array.from(new Set(successfulOrders.map(o => o.voucherType)));

    const profile = {
      phoneNumber,
      name,
      status: 'active',
      totalOrdersCount,
      lifetimeSpent,
      firstPurchaseDate,
      lastPurchasedDate,
      purchasedVoucherTypes,
      usedChannels,
      totalQuantity,
      defaultPaymentChannel: 'hubtel'
    };

    res.status(200).json({
      success: true,
      data: {
        profile,
        orders
      }
    });
  } catch (error) {
    console.error('Error in getCustomerByPhoneNumber:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while fetching customer details.', 500));
    }
  }
};

/**
 * Retrieve statistics for customers (unique count, ussd unique, web unique)
 * GET /api/admin/customers/stats
 */
export const getCustomerStats = async (req, res, next) => {
  // #swagger.tags = ['Customer Management']
  // #swagger.summary = 'Get Customer Statistics'
  // #swagger.description = 'Retrieves overall customer statistics including total count and channel breakdown (Web vs USSD).'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Customer stats retrieved successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/CustomerStatsResponse" }
            }
        }
     }
  */
  try {
    const [totalCustomersGroup, ussdCustomersGroup, webCustomersGroup] = await Promise.all([
      prisma.order.groupBy({
        by: ['phoneNumber']
      }),
      prisma.order.groupBy({
        by: ['phoneNumber'],
        where: { channel: 'USSD' }
      }),
      prisma.order.groupBy({
        by: ['phoneNumber'],
        where: { channel: 'WEB' }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalCustomers: totalCustomersGroup.length,
        totalCustomersUssd: ussdCustomersGroup.length,
        totalCustomersWeb: webCustomersGroup.length
      }
    });
  } catch (error) {
    console.error('Error in getCustomerStats:', error);
    next(new AppError('An unexpected error occurred while generating customer statistics.', 500));
  }
};

