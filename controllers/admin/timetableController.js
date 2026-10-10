import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { uploadTimetableDocumentToCloudinary, formatFileSize } from '../../utils/upload/cloudinaryHelper.js';

/**
 * Get all timetable configurations for admin management UI.
 */
export const getAdminTimetables = async (req, res, next) => {
  // #swagger.tags = ['Admin - Timetables']
  // #swagger.summary = 'Get All Timetable Configurations'
  // #swagger.description = 'Retrieves all examination timetable configurations (BECE & WASSCE/NOVDEC) including published and draft items.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Admin timetables retrieved successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/TimetablesListResponse" }
          }
        }
     }
  */
  try {
    const timetables = await prisma.timetable.findMany({
      orderBy: { createdAt: 'asc' }
    });

    return res.status(200).json({
      success: true,
      message: 'Timetables retrieved successfully.',
      data: timetables
    });
  } catch (error) {
    next(new AppError(error.message || 'Failed to fetch admin timetables', 500));
  }
};

/**
 * Create or update timetable configuration metadata and/or file.
 */
export const updateTimetable = async (req, res, next) => {
  // #swagger.tags = ['Admin - Timetables']
  // #swagger.summary = 'Update Timetable Configuration & Document'
  // #swagger.description = 'Creates or updates metadata (title, examYear, startDate, description, isPublished) and/or replaces the timetable file (PDF, DOC, DOCX) for a given type (BECE or WASSCE_NOVDEC).'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: false,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string", example: "BECE '26 Timetable" },
                examYear: { type: "integer", example: 2026 },
                startDate: { type: "string", example: "2026-06-01" },
                description: { type: "string", example: "Official WAEC BECE 2026 timetable. All 10 subjects, dates, and times in one PDF." },
                isPublished: { type: "boolean", example: true },
                file: { type: "string", format: "binary", description: "Optional PDF / DOC / DOCX timetable file" }
              }
            }
          }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'Timetable created or updated successfully',
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                message: { type: "string", example: "BECE timetable updated successfully" },
                data: { $ref: "#/components/schemas/TimetableItem" }
              }
            }
          }
        }
     }
  */
  try {
    const { type } = req.params;

    // Validate type enum
    const normalizedType = type ? type.toUpperCase() : '';
    if (!['BECE', 'WASSCE_NOVDEC'].includes(normalizedType)) {
      throw new AppError('Invalid timetable type. Must be BECE or WASSCE_NOVDEC.', 400);
    }

    const existingTimetable = await prisma.timetable.findUnique({
      where: { type: normalizedType }
    });

    const { title, examYear, startDate, description, isPublished } = req.body;

    const defaultTitle = normalizedType === 'BECE' ? "BECE '26 Timetable" : "WASSCE '26 Timetable";
    const updateData = {};

    if (title !== undefined) updateData.title = title.trim();
    if (examYear !== undefined) updateData.examYear = parseInt(examYear, 10) || 2026;
    if (startDate !== undefined) {
      updateData.startDate = startDate ? new Date(startDate) : null;
    }
    if (description !== undefined) updateData.description = description.trim();
    if (isPublished !== undefined) {
      // Handle boolean or string boolean from multipart/form-data
      updateData.isPublished = isPublished === true || isPublished === 'true' || isPublished === '1';
    }

    // Process file upload if provided in request
    if (req.file) {
      let cloudinaryResult;
      try {
        cloudinaryResult = await uploadTimetableDocumentToCloudinary(req.file.buffer, req.file.originalname);
      } catch (uploadErr) {
        console.error('File upload error during timetable update:', uploadErr);
        // Fallback: create local reference if Cloudinary fails
        cloudinaryResult = {
          secure_url: `/uploads/timetables/${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`
        };
      }

      updateData.fileUrl = cloudinaryResult.secure_url || cloudinaryResult.url;
      updateData.fileName = req.file.originalname;
      updateData.fileSize = formatFileSize(req.file.size);
    }

    const timetable = await prisma.timetable.upsert({
      where: { type: normalizedType },
      update: updateData,
      create: {
        type: normalizedType,
        title: updateData.title || defaultTitle,
        examYear: updateData.examYear || 2026,
        startDate: updateData.startDate || null,
        description: updateData.description || null,
        isPublished: updateData.isPublished !== undefined ? updateData.isPublished : true,
        fileUrl: updateData.fileUrl || null,
        fileName: updateData.fileName || null,
        fileSize: updateData.fileSize || null
      }
    });

    logActivity({
      action: 'TIMETABLE_UPDATED',
      details: { type: normalizedType, updatedFields: Object.keys(updateData) },
      req
    });

    return res.status(200).json({
      success: true,
      message: `${normalizedType === 'WASSCE_NOVDEC' ? 'WASSCE / NOVDEC' : normalizedType} timetable updated successfully.`,
      data: timetable
    });
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(error.message || 'Failed to update timetable', 500));
  }
};
