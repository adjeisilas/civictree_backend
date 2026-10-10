import config, { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { readSpreadsheetRows } from '../../utils/file/spreadsheet.js';
import { encryptPin, readPin, maskPin, withMaskedPin } from '../../utils/voucher/voucherPin.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { uploadFileToCloudinary } from '../../utils/upload/cloudinaryHelper.js';
import { notifyAllAdmins } from '../../utils/notification/pushHelper.js';

// ==========================================
// VOUCHER CONFIGURATION CONTROLLERS
// ==========================================

/**
 * Create voucher configuration (Admin can only create it once)
 * POST /api/vouchers/configs
 */
export const createVoucherConfig = async (req, res, next) => {
  // #swagger.tags = ['Voucher Configuration']
  // #swagger.summary = 'Create voucher configuration'
  // #swagger.description = 'Creates the single configuration record for prices and stock limits for WASSCE/NOVDEC and BECE vouchers. Only one config record is allowed in the entire system.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/CreateVoucherConfigRequest" }
            }
        }
     }
  */
  /* #swagger.responses[201] = {
        description: 'Voucher configuration created successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherConfigResponse" }
            }
        }
     }
  */
  try {
    const { currency, wassceNovdecPrice, wassceNovdecLimit, becePrice, beceLimit } = req.body;

    // Check if configuration already exists
    const existingConfig = await prisma.voucherConfig.findFirst();
    if (existingConfig) {
      throw new AppError('Voucher configuration already exists. You can only update the existing configuration.', 400);
    }

    if (
      wassceNovdecPrice < 0 || wassceNovdecLimit < 0 ||
      becePrice < 0 || beceLimit < 0
    ) {
      throw new AppError('Prices and stock limits must be non-negative values.', 400);
    }

    const config = await prisma.voucherConfig.create({
      data: {
        currency: currency || 'GHS',
        wassceNovdecPrice,
        wassceNovdecLimit: parseInt(wassceNovdecLimit, 10),
        becePrice,
        beceLimit: parseInt(beceLimit, 10)
      }
    });

    logActivity({
      userId: req.user.id,
      action: 'VOUCHER_CONFIG_CREATED',
      details: { configId: config.id },
      req
    });

    notifyAllAdmins({
      title: 'Voucher Price Config Created',
      message: `Pricing set for WASSCE/NOVDEC (GHS ${wassceNovdecPrice}) and BECE (GHS ${becePrice}) by ${req.user.name || 'an Admin'}.`,
      type: 'VOUCHER',
      sendPush: false
    }).catch(err => console.error('Failed to notify admins of config creation:', err));

    res.status(201).json({
      success: true,
      message: 'Voucher configuration created successfully.',
      data: config
    });
  } catch (error) {
    console.error('Error in createVoucherConfig:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while creating voucher configuration.', 500));
    }
  }
};

/**
 * Get voucher configurations
 * GET /api/vouchers/configs
 */
export const getVoucherConfigs = async (req, res, next) => {
  // #swagger.tags = ['Voucher Configuration']
  // #swagger.summary = 'Get voucher configurations'
  // #swagger.description = 'Fetches the current prices, limits, and currency configuration settings.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Voucher configurations retrieved successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherConfigResponse" }
            }
        }
     }
  */
  try {
    const config = await prisma.voucherConfig.findFirst();
    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('Error in getVoucherConfigs:', error);
    next(new AppError('An unexpected error occurred while retrieving configurations.', 500));
  }
};

/**
 * Update voucher configurations
 * PUT /api/vouchers/configs
 */
export const updateVoucherConfig = async (req, res, next) => {
  // #swagger.tags = ['Voucher Configuration']
  // #swagger.summary = 'Update voucher configuration'
  // #swagger.description = 'Updates prices and low stock alert thresholds for result checker vouchers.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/CreateVoucherConfigRequest" }
            }
        }
     }
  */
  /* #swagger.responses[200] = {
        description: 'Voucher configuration updated successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherConfigResponse" }
            }
        }
     }
  */
  try {
    const voucherConfig = await prisma.voucherConfig.findFirst();
    if (!voucherConfig) {
      throw new AppError('No configuration found. Please create one first.', 404);
    }

    const { 
      currency, 
      wassceNovdecPrice, 
      wassceNovdecLimit, 
      becePrice, 
      beceLimit, 
      wassceNovdecReleaseDate,
      beceReleaseDate
    } = req.body;

    const updateData = {};
    if (currency) updateData.currency = currency;
    if (wassceNovdecPrice !== undefined) {
      if (wassceNovdecPrice < 0) throw new AppError('WASSCE/NOVDEC price must be positive.', 400);
      updateData.wassceNovdecPrice = wassceNovdecPrice;
    }
    if (wassceNovdecLimit !== undefined) {
      if (wassceNovdecLimit < 0) throw new AppError('WASSCE/NOVDEC limit must be positive.', 400);
      updateData.wassceNovdecLimit = parseInt(wassceNovdecLimit, 10);
    }
    if (becePrice !== undefined) {
      if (becePrice < 0) throw new AppError('BECE price must be positive.', 400);
      updateData.becePrice = becePrice;
    }
    if (beceLimit !== undefined) {
      if (beceLimit < 0) throw new AppError('BECE limit must be positive.', 400);
      updateData.beceLimit = parseInt(beceLimit, 10);
    }
    if (wassceNovdecReleaseDate !== undefined) {
      updateData.wassceNovdecReleaseDate = wassceNovdecReleaseDate ? new Date(wassceNovdecReleaseDate) : null;
    }
    if (beceReleaseDate !== undefined) {
      updateData.beceReleaseDate = beceReleaseDate ? new Date(beceReleaseDate) : null;
    }

    const updatedConfig = await prisma.voucherConfig.update({
      where: { id: voucherConfig.id },
      data: updateData
    });

    logActivity({
      userId: req.user.id,
      action: 'VOUCHER_CONFIG_UPDATED',
      details: { updatedFields: Object.keys(updateData) },
      req
    });

    notifyAllAdmins({
      title: 'Voucher Price Config Updated',
      message: `Voucher configurations updated by ${req.user.name || 'an Admin'}.`,
      type: 'VOUCHER',
      sendPush: false
    }).catch(err => console.error('Failed to notify admins of config update:', err));

    res.status(200).json({
      success: true,
      message: 'Voucher configuration updated successfully.',
      data: updatedConfig
    });
  } catch (error) {
    console.error('Error in updateVoucherConfig:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while updating voucher configuration.', 500));
    }
  }
};

/**
 * Update exam results release dates
 * PUT /api/vouchers/configs/release-dates
 */
export const updateVoucherReleaseDates = async (req, res, next) => {
  // #swagger.tags = ['Voucher Configuration']
  // #swagger.summary = 'Update exam results release dates'
  // #swagger.description = 'Updates official release dates for WASSCE/NOVDEC and BECE exams.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        wassceReleaseDate: { type: "string", format: "date-time", example: "2026-10-15T00:00:00.000Z" },
                        beceReleaseDate: { type: "string", format: "date-time", example: "2026-09-20T00:00:00.000Z" },
                        novdecReleaseDate: { type: "string", format: "date-time", example: "2026-12-05T00:00:00.000Z" }
                    }
                }
            }
        }
     }
  */
  try {
    const voucherConfig = await prisma.voucherConfig.findFirst();
    if (!voucherConfig) {
      throw new AppError('No configuration found. Please create one first.', 404);
    }

    const { wassceNovdecReleaseDate, beceReleaseDate } = req.body;

    const updateData = {};
    if (wassceNovdecReleaseDate !== undefined) {
      updateData.wassceNovdecReleaseDate = wassceNovdecReleaseDate ? new Date(wassceNovdecReleaseDate) : null;
    }
    if (beceReleaseDate !== undefined) {
      updateData.beceReleaseDate = beceReleaseDate ? new Date(beceReleaseDate) : null;
    }

    const updatedConfig = await prisma.voucherConfig.update({
      where: { id: voucherConfig.id },
      data: updateData
    });

    logActivity({
      userId: req.user.id,
      action: 'VOUCHER_RELEASE_DATES_UPDATED',
      details: { updatedFields: Object.keys(updateData) },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Exam results release dates updated successfully.',
      data: updatedConfig
    });
  } catch (error) {
    console.error('Error in updateVoucherReleaseDates:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while updating release dates.', 500));
    }
  }
};

/**
 * Delete voucher configuration
 * DELETE /api/vouchers/configs
 */
export const deleteVoucherConfig = async (req, res, next) => {
  // #swagger.tags = ['Voucher Configuration']
  // #swagger.summary = 'Delete voucher configuration'
  // #swagger.description = 'Removes the voucher pricing and alert configuration setting from the database.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Voucher configuration deleted successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        message: { type: "string", example: "Voucher configuration deleted successfully." }
                    }
                }
            }
        }
     }
  */
  try {
    const voucherConfig = await prisma.voucherConfig.findFirst();
    if (!voucherConfig) {
      throw new AppError('No configuration found to delete.', 404);
    }

    await prisma.voucherConfig.delete({
      where: { id: voucherConfig.id }
    });

    logActivity({
      userId: req.user.id,
      action: 'VOUCHER_CONFIG_DELETED',
      details: { configId: voucherConfig.id },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Voucher configuration deleted successfully.'
    });
  } catch (error) {
    console.error('Error in deleteVoucherConfig:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while deleting configuration.', 500));
    }
  }
};

// ==========================================
// VOUCHER UPLOAD CONTROLLERS
// ==========================================

/**
 * Bulk upload vouchers via CSV or Excel
 * POST /api/vouchers/upload-bulk
 */
export const uploadVouchersBulk = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Bulk upload vouchers (CSV/Excel)'
  // #swagger.description = 'Allows upload of result checker vouchers using a CSV or Excel (.xlsx/.xls) file. The file is uploaded to Cloudinary as a raw backup and parsed. Required file columns: [Serial Number, Pin Number]. All records will be assigned the selected voucher type.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "multipart/form-data": {
                schema: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["WASSCE_NOVDEC", "BECE"],
                            description: "Voucher type for all rows in the file"
                        },
                        file: {
                            type: "string",
                            format: "binary",
                            description: "CSV or Excel file with columns: [Serial Number, Pin Number]"
                        }
                    },
                    required: ["type", "file"]
                }
            }
        }
     } */
  /* #swagger.responses[201] = {
        description: 'File processed and vouchers uploaded successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherUploadBulkResponse" }
            }
        }
     }
  */
  try {
    const { type } = req.body;
    if (!type) {
      throw new AppError('Voucher type is required.', 400);
    }

    const validTypes = new Set(['WASSCE_NOVDEC', 'BECE']);
    const uppercaseType = type.toUpperCase();
    if (!validTypes.has(uppercaseType)) {
      throw new AppError('Invalid voucher type. Must be WASSCE_NOVDEC or BECE.', 400);
    }

    if (!req.file) {
      throw new AppError('Please upload a CSV or Excel file.', 400);
    }

    // 1. Stream the file buffer to Cloudinary (optional/safe upload)
    let fileUrl = null;
    try {
      if (config.cloudinary && config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret) {
        console.log('[UPLOAD] Streaming file to Cloudinary...');
        const cloudinaryResult = await uploadFileToCloudinary(req.file.buffer, req.file.originalname);
        fileUrl = cloudinaryResult.secure_url;
        console.log('[UPLOAD] Uploaded to Cloudinary:', fileUrl);
      } else {
        console.warn('[UPLOAD] Cloudinary is not configured. Skipping remote file upload.');
      }
    } catch (uploadError) {
      console.error('[UPLOAD] Cloudinary upload failed. Proceeding without file URL:', uploadError);
    }

    // 2. Parse the uploaded spreadsheet (.xlsx or .csv)
    const rows = await readSpreadsheetRows(req.file);

    if (rows.length === 0) {
      throw new AppError('The uploaded file is empty.', 400);
    }

    const parsedVouchers = [];

    // Check if the first row is a header
    const firstRow = rows[0];
    let startIdx = 0;
    let serialColIdx = 0; // Default to column 0 for serialNumber
    let pinColIdx = 1;    // Default to column 1 for pin

    if (firstRow && firstRow.length >= 2) {
      const cell0Str = firstRow[0] ? firstRow[0].toString().toLowerCase().trim() : '';
      const cell1Str = firstRow[1] ? firstRow[1].toString().toLowerCase().trim() : '';

      const isHeader0 = cell0Str.includes('serial') || cell0Str.includes('pin') || cell0Str.includes('number') || cell0Str.includes('code');
      const isHeader1 = cell1Str.includes('serial') || cell1Str.includes('pin') || cell1Str.includes('number') || cell1Str.includes('code');

      if (isHeader0 || isHeader1) {
        startIdx = 1;

        // Dynamically assign indices based on headers
        const col0IsPin = cell0Str.includes('pin') || cell0Str.includes('code');
        const col1IsPin = cell1Str.includes('pin') || cell1Str.includes('code');
        const col0IsSerial = cell0Str.includes('serial') || cell0Str.includes('number') || cell0Str.includes('sn');
        const col1IsSerial = cell1Str.includes('serial') || cell1Str.includes('number') || cell1Str.includes('sn');

        if (col0IsPin && col1IsSerial) {
          serialColIdx = 1;
          pinColIdx = 0;
        } else if (col0IsSerial && col1IsPin) {
          serialColIdx = 0;
          pinColIdx = 1;
        } else if (col0IsPin) {
          pinColIdx = 0;
          serialColIdx = 1;
        } else if (col0IsSerial) {
          serialColIdx = 0;
          pinColIdx = 1;
        } else if (col1IsPin) {
          pinColIdx = 1;
          serialColIdx = 0;
        } else if (col1IsSerial) {
          serialColIdx = 1;
          pinColIdx = 0;
        }
      }
    }

    // Fallback content-based auto-detection if no headers were matched
    if (startIdx === 0 && rows.length > 0) {
      // Look at the first row to determine types (alphabetic/alphanumeric vs purely numeric)
      const testRow = rows[0];
      if (testRow && testRow.length >= 2) {
        const val0 = testRow[0] ? testRow[0].toString().trim() : '';
        const val1 = testRow[1] ? testRow[1].toString().trim() : '';

        const isVal0Alpha = /[a-zA-Z]/.test(val0);
        const isVal1Alpha = /[a-zA-Z]/.test(val1);
        const isVal0NumericOnly = /^\d+$/.test(val0);
        const isVal1NumericOnly = /^\d+$/.test(val1);

        if (isVal0Alpha && isVal1NumericOnly) {
          serialColIdx = 0;
          pinColIdx = 1;
        } else if (isVal1Alpha && isVal0NumericOnly) {
          serialColIdx = 1;
          pinColIdx = 0;
        }
      }
    }

    // Extract records
    for (let i = startIdx; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;

      const serialNumber = row[serialColIdx] ? row[serialColIdx].toString().trim() : '';
      const pin = row[pinColIdx] ? row[pinColIdx].toString().trim() : '';

      if (!serialNumber || !pin) continue;

      parsedVouchers.push({
        type: uppercaseType,
        serialNumber,
        pin
      });
    }

    if (parsedVouchers.length === 0) {
      throw new AppError('No valid voucher records found in the uploaded file.', 400);
    }

    // 3. Filter out duplicates (ensure database constraint integrity)
    const serialNumbers = parsedVouchers.map(v => v.serialNumber);
    const existingVouchers = await prisma.voucher.findMany({
      where: { 
        serialNumber: { in: serialNumbers },
        type: uppercaseType
      },
      select: { serialNumber: true }
    });
    const existingSerials = new Set(existingVouchers.map(v => v.serialNumber));

    // Keep unique records not already present in the database
    const uniqueVouchersToInsert = [];
    const localSerials = new Set();

    for (const v of parsedVouchers) {
      if (existingSerials.has(v.serialNumber)) {
        continue;
      }
      if (localSerials.has(v.serialNumber)) {
        continue;
      }
      localSerials.add(v.serialNumber);
      uniqueVouchersToInsert.push(v);
    }

    const totalDuplicates = parsedVouchers.length - uniqueVouchersToInsert.length;

    // 4. Create history record
    const uploadHistory = await prisma.voucherUploadHistory.create({
      data: {
        filename: req.file.originalname,
        fileUrl: fileUrl,
        uploadType: req.file.originalname.endsWith('.csv') ? 'BULK_CSV' : 'BULK_EXCEL',
        totalUploaded: uniqueVouchersToInsert.length,
        uploadedById: req.user.id
      }
    });

    // 5. Bulk insert unique vouchers
    if (uniqueVouchersToInsert.length > 0) {
      await prisma.voucher.createMany({
        data: uniqueVouchersToInsert.map(v => ({
          type: v.type,
          serialNumber: v.serialNumber,
          // Stored encrypted; readable only with SECRET_ENC_KEY
          pin: encryptPin(v.pin),
          status: 'AVAILABLE',
          uploadHistoryId: uploadHistory.id
        }))
      });
    }

    logActivity({
      userId: req.user.id,
      action: 'VOUCHERS_UPLOAD_BULK',
      details: {
        uploadHistoryId: uploadHistory.id,
        insertedCount: uniqueVouchersToInsert.length,
        skippedDuplicates: totalDuplicates,
        filename: req.file.originalname,
        voucherType: uppercaseType
      },
      req
    });

    notifyAllAdmins({
      title: 'Bulk Vouchers Uploaded',
      message: `${uniqueVouchersToInsert.length} x ${uppercaseType} vouchers uploaded successfully by ${req.user.name || 'an Admin'}.`,
      type: 'VOUCHER',
      sendPush: false
    }).catch(err => console.error('Failed to notify admins of bulk upload:', err));

    res.status(201).json({
      success: true,
      message: `File processed successfully. ${uniqueVouchersToInsert.length} vouchers uploaded.`,
      data: {
        uploadId: uploadHistory.id,
        totalParsed: parsedVouchers.length,
        inserted: uniqueVouchersToInsert.length,
        skippedDuplicates: totalDuplicates,
        fileUrl: fileUrl
      }
    });
  } catch (error) {
    console.error('Error in uploadVouchersBulk:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while processing bulk voucher upload.', 500));
    }
  }
};

/**
 * Dry-run check for bulk voucher duplicates
 * POST /api/admin/vouchers/check-bulk-duplicates
 */
export const checkVouchersBulkDuplicates = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Dry-run check for bulk voucher duplicates (CSV/Excel)'
  // #swagger.description = 'Parses the uploaded CSV/Excel file and compares pins/serials against the database to report duplicates. Does not insert any records.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "multipart/form-data": {
                schema: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["WASSCE_NOVDEC", "BECE"],
                            description: "Voucher type for all rows in the file"
                        },
                        file: {
                            type: "string",
                            format: "binary",
                            description: "CSV or Excel file with columns: [Serial Number, Pin Number]"
                        }
                    },
                    required: ["type", "file"]
                }
            }
        }
     } */
  /* #swagger.responses[200] = {
        description: 'File processed and duplicates reported successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherCheckBulkDuplicatesResponse" }
            }
        }
     }
  */
  try {
    const { type } = req.body;
    if (!type) {
      throw new AppError('Voucher type is required.', 400);
    }

    const validTypes = new Set(['WASSCE_NOVDEC', 'BECE']);
    const uppercaseType = type.toUpperCase();
    if (!validTypes.has(uppercaseType)) {
      throw new AppError('Invalid voucher type. Must be WASSCE_NOVDEC or BECE.', 400);
    }

    if (!req.file) {
      throw new AppError('Please upload a CSV or Excel file.', 400);
    }

    // Parse file using SheetJS (xlsx)
    const rows = await readSpreadsheetRows(req.file);

    if (rows.length === 0) {
      throw new AppError('The uploaded file is empty.', 400);
    }

    const parsedVouchers = [];

    // Check if the first row is a header
    const firstRow = rows[0];
    let startIdx = 0;
    let serialColIdx = 0; // Default to column 0 for serialNumber
    let pinColIdx = 1;    // Default to column 1 for pin

    if (firstRow && firstRow.length >= 2) {
      const cell0Str = firstRow[0] ? firstRow[0].toString().toLowerCase().trim() : '';
      const cell1Str = firstRow[1] ? firstRow[1].toString().toLowerCase().trim() : '';

      const isHeader0 = cell0Str.includes('serial') || cell0Str.includes('pin') || cell0Str.includes('number') || cell0Str.includes('code');
      const isHeader1 = cell1Str.includes('serial') || cell1Str.includes('pin') || cell1Str.includes('number') || cell1Str.includes('code');

      if (isHeader0 || isHeader1) {
        startIdx = 1;

        // Dynamically assign indices based on headers
        const col0IsPin = cell0Str.includes('pin') || cell0Str.includes('code');
        const col1IsPin = cell1Str.includes('pin') || cell1Str.includes('code');
        const col0IsSerial = cell0Str.includes('serial') || cell0Str.includes('number') || cell0Str.includes('sn');
        const col1IsSerial = cell1Str.includes('serial') || cell1Str.includes('number') || cell1Str.includes('sn');

        if (col0IsPin && col1IsSerial) {
          serialColIdx = 1;
          pinColIdx = 0;
        } else if (col0IsSerial && col1IsPin) {
          serialColIdx = 0;
          pinColIdx = 1;
        } else if (col0IsPin) {
          pinColIdx = 0;
          serialColIdx = 1;
        } else if (col0IsSerial) {
          serialColIdx = 0;
          pinColIdx = 1;
        } else if (col1IsPin) {
          pinColIdx = 1;
          serialColIdx = 0;
        } else if (col1IsSerial) {
          serialColIdx = 1;
          pinColIdx = 0;
        }
      }
    }

    // Fallback content-based auto-detection if no headers were matched
    if (startIdx === 0 && rows.length > 0) {
      // Look at the first row to determine types (alphabetic/alphanumeric vs purely numeric)
      const testRow = rows[0];
      if (testRow && testRow.length >= 2) {
        const val0 = testRow[0] ? testRow[0].toString().trim() : '';
        const val1 = testRow[1] ? testRow[1].toString().trim() : '';

        const isVal0Alpha = /[a-zA-Z]/.test(val0);
        const isVal1Alpha = /[a-zA-Z]/.test(val1);
        const isVal0NumericOnly = /^\d+$/.test(val0);
        const isVal1NumericOnly = /^\d+$/.test(val1);

        if (isVal0Alpha && isVal1NumericOnly) {
          serialColIdx = 0;
          pinColIdx = 1;
        } else if (isVal1Alpha && isVal0NumericOnly) {
          serialColIdx = 1;
          pinColIdx = 0;
        }
      }
    }

    // Extract records
    for (let i = startIdx; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;

      const serialNumber = row[serialColIdx] ? row[serialColIdx].toString().trim() : '';
      const pin = row[pinColIdx] ? row[pinColIdx].toString().trim() : '';

      if (!serialNumber || !pin) continue;

      parsedVouchers.push({
        type: uppercaseType,
        serialNumber,
        pin
      });
    }

    if (parsedVouchers.length === 0) {
      throw new AppError('No valid voucher records found in the uploaded file.', 400);
    }

    // Filter out duplicates (ensure database constraint integrity)
    const serialNumbers = parsedVouchers.map(v => v.serialNumber);
    const existingVouchers = await prisma.voucher.findMany({
      where: { 
        serialNumber: { in: serialNumbers },
        type: uppercaseType
      },
      select: { serialNumber: true }
    });
    const existingSerialsMap = new Set(existingVouchers.map(v => v.serialNumber));

    const uniqueVouchersToInsert = [];
    const localSerials = new Set();
    const databaseDuplicates = [];
    const localDuplicates = [];

    for (const v of parsedVouchers) {
      if (existingSerialsMap.has(v.serialNumber)) {
        databaseDuplicates.push({
          serialNumber: v.serialNumber,
          pin: v.pin
        });
        continue;
      }
      if (localSerials.has(v.serialNumber)) {
        localDuplicates.push({
          serialNumber: v.serialNumber,
          pin: v.pin
        });
        continue;
      }
      localSerials.add(v.serialNumber);
      uniqueVouchersToInsert.push(v);
    }

    const totalDuplicates = parsedVouchers.length - uniqueVouchersToInsert.length;

    res.status(200).json({
      success: true,
      message: `File check completed. Found ${totalDuplicates} duplicates out of ${parsedVouchers.length} records.`,
      data: {
        totalParsed: parsedVouchers.length,
        totalUnique: uniqueVouchersToInsert.length,
        totalDuplicates,
        duplicates: {
          database: databaseDuplicates,
          local: localDuplicates
        }
      }
    });
  } catch (error) {
    console.error('Error in checkVouchersBulkDuplicates:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while checking bulk voucher duplicates.', 500));
    }
  }
};

/**
 * Upload single voucher manually
 * POST /api/vouchers/upload-single
 */
export const uploadVoucherSingle = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Upload a single voucher'
  // #swagger.description = 'Manually creates a single results checker voucher record.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/UploadVoucherSingleRequest" }
            }
        }
     }
  */
  /* #swagger.responses[201] = {
        description: 'Voucher uploaded successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherResponse" }
            }
        }
     }
  */
  try {
    const { type, serialNumber, pin } = req.body;

    if (!type || !serialNumber || !pin) {
      throw new AppError('Voucher type, serialNumber, and pin are required.', 400);
    }

    const validTypes = new Set(['WASSCE_NOVDEC', 'BECE']);
    const upperType = type.toUpperCase();
    if (!validTypes.has(upperType)) {
      throw new AppError('Invalid voucher type. Must be WASSCE_NOVDEC or BECE.', 400);
    }

    // Check serial uniqueness
    const existing = await prisma.voucher.findUnique({
      where: {
        serialNumber_type: {
          serialNumber,
          type: upperType
        }
      }
    });

    if (existing) {
      throw new AppError('A voucher with this serial number already exists.', 400);
    }

    // Create single upload history log
    const uploadHistory = await prisma.voucherUploadHistory.create({
      data: {
        filename: null,
        fileUrl: null,
        uploadType: 'SINGLE',
        totalUploaded: 1,
        uploadedById: req.user.id
      }
    });

    const voucher = await prisma.voucher.create({
      data: {
        type: type.toUpperCase(),
        serialNumber,
        // Stored encrypted; readable only with SECRET_ENC_KEY
        pin: encryptPin(pin),
        status: 'AVAILABLE',
        uploadHistoryId: uploadHistory.id
      }
    });

    logActivity({
      userId: req.user.id,
      action: 'VOUCHER_CREATED_SINGLE',
      details: { voucherId: voucher.id, serialNumber },
      req
    });

    res.status(201).json({
      success: true,
      message: 'Voucher uploaded successfully.',
      data: voucher
    });
  } catch (error) {
    console.error('Error in uploadVoucherSingle:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while creating voucher.', 500));
    }
  }
};

// ==========================================
// VOUCHER RETRIEVAL & CRUD CONTROLLERS
// ==========================================

/**
 * Get all vouchers (Paginated, filters)
 * GET /api/vouchers
 */
export const getAllVouchers = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'List all vouchers (Paginated)'
  // #swagger.description = 'Fetches all result checker vouchers in the system. Supports filtering by type and status.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['page'] = { in: 'query', type: 'integer', default: 1 } */
  /* #swagger.parameters['limit'] = { in: 'query', type: 'integer', default: 10 } */
  /* #swagger.parameters['type'] = { in: 'query', type: 'string', enum: ["WASSCE_NOVDEC", "BECE"] } */
  /* #swagger.parameters['status'] = { in: 'query', type: 'string', enum: ["AVAILABLE", "SOLD"] } */
  /* #swagger.responses[200] = {
        description: 'Vouchers retrieved successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        results: { type: "integer", example: 10 },
                        pagination: {
                            type: "object",
                            properties: {
                                page: { type: "integer" },
                                limit: { type: "integer" },
                                totalResults: { type: "integer" },
                                totalPages: { type: "integer" }
                            }
                        },
                        data: {
                            type: "array",
                            items: { $ref: "#/components/schemas/VoucherResponse" }
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

    const { type, status } = req.query;
    const where = {};

    if (type) where.type = type.toUpperCase();
    if (status) where.status = status.toUpperCase();

    const [vouchers, totalResults] = await Promise.all([
      prisma.voucher.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          uploadHistory: {
            select: {
              filename: true,
              uploadType: true
            }
          }
        }
      }),
      prisma.voucher.count({ where })
    ]);

    const totalPages = Math.ceil(totalResults / limit);

    res.status(200).json({
      success: true,
      results: vouchers.length,
      pagination: {
        page,
        limit,
        totalResults,
        totalPages
      },
      // Lists show masked PINs; use GET /api/vouchers/:id/pin to reveal one
      data: withMaskedPin(vouchers)
    });
  } catch (error) {
    console.error('Error in getAllVouchers:', error);
    next(new AppError('An unexpected error occurred while retrieving vouchers.', 500));
  }
};

/**
 * Get voucher by ID
 * GET /api/vouchers/:id
 */
export const getVoucherById = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Get voucher details by ID'
  // #swagger.description = 'Fetches detail of a single results checker voucher.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Voucher details retrieved successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherResponse" }
            }
        }
     }
  */
  try {
    const voucher = await prisma.voucher.findUnique({
      where: { id: req.params.id },
      include: {
        uploadHistory: true
      }
    });

    if (!voucher) {
      throw new AppError('Voucher not found.', 404);
    }

    res.status(200).json({
      success: true,
      // Masked; use GET /api/vouchers/:id/pin to reveal it
      data: withMaskedPin(voucher)
    });
  } catch (error) {
    console.error('Error in getVoucherById:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while fetching voucher details.', 500));
    }
  }
};

/**
 * Update voucher details
 * PATCH /api/vouchers/:id
 */
export const updateVoucher = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Update a voucher'
  // #swagger.description = 'Updates details such as status, pin, serial number, and type for a results checker voucher.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        type: { type: "string", enum: ["WASSCE_NOVDEC", "BECE"] },
                        serialNumber: { type: "string" },
                        pin: { type: "string" },
                        status: { type: "string", enum: ["AVAILABLE", "SOLD"] }
                    }
                }
            }
        }
     } */
  try {
    const { id } = req.params;
    const { type, serialNumber, pin, status } = req.body;

    const voucher = await prisma.voucher.findUnique({ where: { id } });
    if (!voucher) {
      throw new AppError('Voucher not found.', 404);
    }

    const updateData = {};
    if (type) {
      const validTypes = new Set(['WASSCE_NOVDEC', 'BECE']);
      if (!validTypes.has(type.toUpperCase())) {
        throw new AppError('Invalid voucher type. Must be WASSCE_NOVDEC or BECE.', 400);
      }
      updateData.type = type.toUpperCase();
    }
    if (serialNumber) {
      updateData.serialNumber = serialNumber;
    }

    if (type || (serialNumber && serialNumber !== voucher.serialNumber)) {
      const targetType = type ? type.toUpperCase() : voucher.type;
      const targetSerial = serialNumber || voucher.serialNumber;
      
      if (targetType !== voucher.type || targetSerial !== voucher.serialNumber) {
        const existing = await prisma.voucher.findUnique({
          where: {
            serialNumber_type: {
              serialNumber: targetSerial,
              type: targetType
            }
          }
        });
        if (existing) {
          throw new AppError('A voucher with this serial number and type already exists.', 400);
        }
      }
    }
    if (pin) updateData.pin = encryptPin(pin);
    if (status) {
      const validStatuses = new Set(['AVAILABLE', 'SOLD']);
      if (!validStatuses.has(status.toUpperCase())) {
        throw new AppError('Invalid status. Must be AVAILABLE or SOLD.', 400);
      }
      updateData.status = status.toUpperCase();
    }

    const updated = await prisma.voucher.update({
      where: { id },
      data: updateData
    });

    logActivity({
      userId: req.user.id,
      action: 'VOUCHER_UPDATED',
      details: { voucherId: id, updatedFields: Object.keys(updateData) },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Voucher updated successfully.',
      data: updated
    });
  } catch (error) {
    console.error('Error in updateVoucher:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while updating voucher.', 500));
    }
  }
};

/**
 * Delete a voucher
 * DELETE /api/vouchers/:id
 */
export const deleteVoucher = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Delete a voucher'
  // #swagger.description = 'Permanently deletes a results checker voucher from the database.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { id } = req.params;

    const voucher = await prisma.voucher.findUnique({ where: { id } });
    if (!voucher) {
      throw new AppError('Voucher not found.', 404);
    }

    await prisma.voucher.delete({ where: { id } });

    logActivity({
      userId: req.user.id,
      action: 'VOUCHER_DELETED',
      details: { voucherId: id, serialNumber: voucher.serialNumber },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Voucher deleted successfully.'
    });
  } catch (error) {
    console.error('Error in deleteVoucher:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while deleting voucher.', 500));
    }
  }
};

/**
 * Get all sold vouchers
 * GET /api/vouchers/sold
 */
export const getSoldVouchers = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'List all sold vouchers'
  // #swagger.description = 'Convenience endpoint to retrieve a paginated list of sold vouchers.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['page'] = { in: 'query', type: 'integer', default: 1 } */
  /* #swagger.parameters['limit'] = { in: 'query', type: 'integer', default: 10 } */
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const [vouchers, totalResults] = await Promise.all([
      prisma.voucher.findMany({
        where: { status: 'SOLD' },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          uploadHistory: {
            select: {
              filename: true,
              uploadType: true
            }
          }
        }
      }),
      prisma.voucher.count({ where: { status: 'SOLD' } })
    ]);

    const totalPages = Math.ceil(totalResults / limit);

    res.status(200).json({
      success: true,
      results: vouchers.length,
      pagination: {
        page,
        limit,
        totalResults,
        totalPages
      },
      // Lists show masked PINs; use GET /api/vouchers/:id/pin to reveal one
      data: withMaskedPin(vouchers)
    });
  } catch (error) {
    console.error('Error in getSoldVouchers:', error);
    next(new AppError('An unexpected error occurred while fetching sold vouchers.', 500));
  }
};

/**
 * Get file upload history log
 * GET /api/vouchers/upload-history
 */
export const getUploadHistory = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'List voucher upload history'
  // #swagger.description = 'Returns a list of all single and bulk voucher uploads completed by administrators.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.parameters['page'] = { in: 'query', type: 'integer', default: 1 } */
  /* #swagger.parameters['limit'] = { in: 'query', type: 'integer', default: 10 } */
  /* #swagger.responses[200] = {
        description: 'Upload history log retrieved successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherHistoryListResponse" }
            }
        }
     }
  */
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const where = {
      uploadedBy: { id: { not: '' } }
    };

    const [history, totalResults] = await Promise.all([
      prisma.voucherUploadHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          uploadedBy: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          }
        }
      }),
      prisma.voucherUploadHistory.count({ where })
    ]);

    const totalPages = Math.ceil(totalResults / limit);

    res.status(200).json({
      success: true,
      results: history.length,
      pagination: {
        page,
        limit,
        totalResults,
        totalPages
      },
      data: history
    });
  } catch (error) {
    console.error('Error in getUploadHistory:', error);
    next(new AppError('An unexpected error occurred while fetching upload history logs.', 500));
  }
};

/**
 * Get voucher upload history details by ID
 * GET /api/vouchers/upload-history/:id
 */
export const getUploadHistoryById = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Get upload history detail by ID'
  // #swagger.description = 'Fetches details of a specific single or bulk voucher upload history record including metadata and list of uploaded vouchers.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Upload history details retrieved successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        data: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                filename: { type: "string", nullable: true },
                                fileUrl: { type: "string", nullable: true },
                                uploadType: { type: "string" },
                                totalUploaded: { type: "integer" },
                                uploadedBy: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string" },
                                        fullName: { type: "string" },
                                        email: { type: "string" }
                                    }
                                },
                                vouchers: {
                                    type: "array",
                                    items: { $ref: "#/components/schemas/VoucherResponse" }
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
    const history = await prisma.voucherUploadHistory.findFirst({
      where: {
        id: req.params.id,
        uploadedBy: { id: { not: '' } }
      },
      include: {
        uploadedBy: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        },
        vouchers: true
      }
    });

    if (!history) {
      throw new AppError('Upload history log not found.', 404);
    }

    res.status(200).json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Error in getUploadHistoryById:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while retrieving upload history details.', 500));
    }
  }
};

/**
 * Get statistics and counts for all voucher types
 * GET /api/vouchers/overview
 */
export const getVoucherOverview = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Get stock levels overview'
  // #swagger.description = 'Fetches available, sold, and total counts for WASSCE/NOVDEC and BECE vouchers.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.responses[200] = {
        description: 'Voucher stock levels overview retrieved successfully',
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/VoucherOverviewResponse" }
            }
        }
     }
  */
  try {
    const counts = await prisma.voucher.groupBy({
      by: ['type', 'status'],
      _count: {
        id: true
      }
    });

    // Initialize stats structure
    const stats = {
      WASSCE_NOVDEC: { available: 0, sold: 0, total: 0 },
      BECE: { available: 0, sold: 0, total: 0 },
      totals: { available: 0, sold: 0, total: 0 }
    };

    for (const item of counts) {
      const type = item.type; // WASSCE, BECE, NOVDEC
      const status = item.status; // AVAILABLE, SOLD
      const count = item._count.id;

      if (stats[type]) {
        if (status === 'AVAILABLE') {
          stats[type].available = count;
          stats.totals.available += count;
        } else if (status === 'SOLD') {
          stats[type].sold = count;
          stats.totals.sold += count;
        }
        stats[type].total += count;
        stats.totals.total += count;
      }
    }

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error in getVoucherOverview:', error);
    next(new AppError('An unexpected error occurred while compiling stock statistics.', 500));
  }
};

/**
 * Reveals a single voucher PIN to an admin.
 * Lists only ever show masked PINs; every reveal is recorded in the activity log,
 * so there is a trail of who saw which PIN and when.
 * GET /api/vouchers/:id/pin
 */
export const revealVoucherPin = async (req, res, next) => {
  // #swagger.tags = ['Voucher Management']
  // #swagger.summary = 'Reveal a voucher PIN'
  // #swagger.description = 'Returns the full PIN for one voucher. The access is recorded in the activity log.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { id } = req.params;

    const voucher = await prisma.voucher.findUnique({
      where: { id },
      select: { id: true, serialNumber: true, type: true, status: true, pin: true, orderId: true }
    });

    if (!voucher) {
      throw new AppError('Voucher not found.', 404);
    }

    logActivity({
      userId: req.user.id,
      action: 'VOUCHER_PIN_REVEALED',
      details: { voucherId: voucher.id, serialNumber: voucher.serialNumber, orderId: voucher.orderId },
      req
    });

    res.status(200).json({
      success: true,
      data: {
        id: voucher.id,
        serialNumber: voucher.serialNumber,
        type: voucher.type,
        status: voucher.status,
        pin: readPin(voucher.pin)
      }
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while revealing the voucher PIN.', 500));
    }
  }
};
