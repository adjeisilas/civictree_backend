import { prisma } from '../../config/config.js';
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
    const [config, wassceNovdecAvailable, beceAvailable] = await Promise.all([
      prisma.voucherConfig.findFirst(),
      prisma.voucher.count({ where: { type: 'WASSCE_NOVDEC', status: 'AVAILABLE' } }),
      prisma.voucher.count({ where: { type: 'BECE', status: 'AVAILABLE' } })
    ]);

    const wassceNovdecLimit = config ? config.wassceNovdecLimit : 100;
    const beceLimit = config ? config.beceLimit : 100;

    res.status(200).json({
      success: true,
      data: {
        currency: config ? config.currency : 'GHS',
        wassceNovdecPrice: config ? Number(config.wassceNovdecPrice) : 0,
        wassceNovdecHasReachedLimit: wassceNovdecAvailable <= wassceNovdecLimit,
        becePrice: config ? Number(config.becePrice) : 0,
        beceHasReachedLimit: beceAvailable <= beceLimit
      }
    });
  } catch (error) {
    console.error('Error in getPublicVoucherConfigs:', error);
    next(new AppError('An unexpected error occurred while fetching public voucher configurations.', 500));
  }
};
