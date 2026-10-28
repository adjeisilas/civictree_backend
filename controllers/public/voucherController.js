import { prisma } from '../../config/config.js';
import { VOUCHER_TYPES, displayNameFor, priceFieldFor, stockLimitFrom } from '../../utils/voucher/voucherTypes.js';
import { AppError } from '../../utils/error/AppError.js';

/**
 * Retrieve pricing and stock limit status (public view, limit values hidden)
 * GET /api/vouchers/configs/public
 */
export const getPublicVoucherConfigs = async (req, res, next) => {
  // #swagger.tags = ['Voucher Configuration']
  // #swagger.summary = 'Get Public Voucher Configurations'
  // #swagger.description = 'Retrieves the current active prices and availability (limit reached status) of WASSCE/NOVDEC and BECE vouchers for display on the public website. Stock limits are hidden for security.'
  /* #swagger.responses[200] = {
        description: 'Voucher configs retrieved successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/PublicVoucherConfigResponse" }
            }
        }
     }
  */
  try {
    const [config, ...availableCounts] = await Promise.all([
      prisma.voucherConfig.findFirst(),
      ...VOUCHER_TYPES.map((type) =>
        prisma.voucher.count({ where: { type, status: 'AVAILABLE' } })
      )
    ]);

    const available = Object.fromEntries(
      VOUCHER_TYPES.map((type, index) => [type, availableCounts[index]])
    );

    // The historical per-type keys are kept so existing clients keep working,
    // and `types` carries the same figures in a shape a new type extends.
    const legacyFields = {};
    for (const type of VOUCHER_TYPES) {
      const price = config ? Number(config[priceFieldFor(type)]) : 0;
      legacyFields[priceFieldFor(type)] = price;
      legacyFields[`${priceFieldFor(type).replace(/Price$/, '')}HasReachedLimit`] =
        available[type] <= stockLimitFrom(config, type);
    }

    res.status(200).json({
      success: true,
      data: {
        currency: config ? config.currency : 'GHS',
        ...legacyFields,
        types: VOUCHER_TYPES.map((type) => ({
          type,
          displayName: displayNameFor(type),
          price: config ? Number(config[priceFieldFor(type)]) : 0,
          hasReachedLimit: available[type] <= stockLimitFrom(config, type)
        }))
      }
    });
  } catch (error) {
    console.error('Error in getPublicVoucherConfigs:', error);
    next(new AppError('An unexpected error occurred while fetching public voucher configurations.', 500));
  }
};
