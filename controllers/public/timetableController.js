import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';

/**
 * Fetch all published timetables for public website cards.
 */
export const getPublicTimetables = async (req, res, next) => {
  // #swagger.tags = ['Public - Timetables']
  // #swagger.summary = 'Get Published Examination Timetables'
  // #swagger.description = 'Retrieves official published WAEC BECE and WASSCE/NOVDEC timetable details and download links for website cards.'
  /* #swagger.responses[200] = {
        description: 'Published timetables retrieved successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/TimetablesListResponse" }
          }
        }
     }
  */
  try {
    const timetables = await prisma.timetable.findMany({
      where: { isPublished: true },
      orderBy: { createdAt: 'asc' }
    });

    return res.status(200).json({
      success: true,
      message: 'Published timetables retrieved successfully.',
      data: timetables
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch public timetables', 500));
  }
};
