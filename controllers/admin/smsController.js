import { prisma } from '../../config/config.js';
import { AppError } from '../../utils/error/AppError.js';
import { VOUCHER_TYPES, displayNameFor } from '../../utils/voucher/voucherTypes.js';
import { sendSMS, sendBatchSMS } from '../../utils/sms/smsHelper.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { notifyAllAdmins } from '../../utils/notification/pushHelper.js';
import { buildSmsRecipients, RECIPIENT_TYPES } from '../../utils/sms/smsRecipients.js';
import { clearSmsContacts, smsContactSummary } from '../../utils/sms/smsContacts.js';

/**
 * Helper handler to process bulk SMS campaigns segmented by VoucherType
 */
const executeBulkSMSByVoucherType = async ({ voucherType, recipientType, title, body, req, res, next }) => {
  try {
    if (!recipientType || !body) {
      throw new AppError('Recipient division and message body are required.', 400);
    }

    const upperType = recipientType.toUpperCase();
    if (!RECIPIENT_TYPES.includes(upperType)) {
      throw new AppError(`Invalid recipientType. Must be ${RECIPIENT_TYPES.join(', ')}.`, 400);
    }

    const { recipients, duplicatesMerged, unusable } = await buildSmsRecipients({
      voucherType,
      recipientType: upperType
    });

    if (recipients.length === 0) {
      return res.status(200).json({
        success: true,
        message: `No recipient contacts found matching ${voucherType} (${upperType}).`,
        data: {
          totalRecipients: 0,
          successCount: 0,
          failedCount: 0
        }
      });
    }

    const successSent = [];
    const failedSent = [];
    const smsMessage = title && title.trim() !== '' ? `${title.trim()}\n\n${body.trim()}` : body;

    const batchSize = 100;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const sendRes = await sendBatchSMS({ recipients: batch, message: smsMessage });
      if (sendRes.success) {
        successSent.push(...batch);
      } else {
        batch.forEach(phone => {
          failedSent.push({ phone, error: sendRes.error || 'Batch failed' });
        });
      }
    }

    logActivity({
      userId: req.user.id,
      action: `SMS_BULK_SEND_${voucherType}`,
      details: {
        voucherType,
        recipientType: upperType,
        totalRecipients: recipients.length,
        duplicatesMerged,
        unusable,
        successCount: successSent.length,
        failedCount: failedSent.length,
        title: title || '',
        body
      },
      req
    });

    notifyAllAdmins({
      title: `${displayNameFor(voucherType)} Bulk SMS Sent`,
      message: `${voucherType} SMS campaign (${upperType}) was sent to ${recipients.length} customers by ${req.user.fullName || req.user.email || 'an Admin'}.`,
      type: 'SMS',
      sendPush: false
    }).catch(err => console.error('Failed to notify admins of bulk SMS:', err));

    return res.status(200).json({
      success: true,
      message: `Bulk SMS campaign for ${voucherType} completed. Sent: ${successSent.length}, Failed: ${failedSent.length}`,
      data: {
        totalRecipients: recipients.length,
        successCount: successSent.length,
        failedCount: failedSent.length,
        duplicatesMerged,
        unusable
      }
    });
  } catch (error) {
    console.error(`Error in send${voucherType}BulkSMS:`, error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError(`An unexpected error occurred while sending ${voucherType} bulk SMS.`, 500));
    }
  }
};

/**
 * Send BECE bulk SMS campaign to a select division of BECE customers (ALL, SUCCESSFUL, FAILED_ONLY)
 * POST /api/admin/sms/bulk/bece
 */
export const sendBECEBulkSMS = async (req, res, next) => {
  // #swagger.tags = ['SMS Campaigns']
  // #swagger.summary = 'Send BECE bulk SMS campaign'
  // #swagger.description = 'Dispatches an SMS campaign to BECE customers. Division options: ALL (all unique BECE orders & BECE USSD dialers), SUCCESSFUL (successful BECE orders), FAILED_ONLY (failed/pending BECE orders).'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        recipientType: {
                            type: "string",
                            enum: ["ALL", "SUCCESSFUL", "FAILED_ONLY"],
                            description: "Target BECE customer division"
                        },
                        title: {
                            type: "string",
                            description: "Campaign identifier or subject line for logs"
                        },
                        body: {
                            type: "string",
                            description: "SMS message text body"
                        }
                    },
                    required: ["recipientType", "body"]
                }
            }
        }
     } */
  /* #swagger.responses[200] = {
        description: 'BECE bulk campaign processed successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        message: { type: "string" },
                        data: {
                            type: "object",
                            properties: {
                                totalRecipients: { type: "integer" },
                                successCount: { type: "integer" },
                                failedCount: { type: "integer" }
                            }
                        }
                    }
                }
            }
        }
     }
  */
  const { recipientType, title, body } = req.body;
  return executeBulkSMSByVoucherType({
    voucherType: 'BECE',
    recipientType,
    title,
    body,
    req,
    res,
    next
  });
};

/**
 * Send WASSCE bulk SMS campaign to a select division of WASSCE customers (ALL, SUCCESSFUL, FAILED_ONLY)
 * POST /api/admin/sms/bulk/wassce
 */
export const sendWASSCEBulkSMS = async (req, res, next) => {
  // #swagger.tags = ['SMS Campaigns']
  // #swagger.summary = 'Send WASSCE bulk SMS campaign'
  // #swagger.description = 'Dispatches an SMS campaign to WASSCE NOVDEC customers. Division options: ALL (all unique WASSCE orders & WASSCE USSD dialers), SUCCESSFUL (successful WASSCE orders), FAILED_ONLY (failed/pending WASSCE orders).'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        recipientType: {
                            type: "string",
                            enum: ["ALL", "SUCCESSFUL", "FAILED_ONLY"],
                            description: "Target WASSCE customer division"
                        },
                        title: {
                            type: "string",
                            description: "Campaign identifier or subject line for logs"
                        },
                        body: {
                            type: "string",
                            description: "SMS message text body"
                        }
                    },
                    required: ["recipientType", "body"]
                }
            }
        }
     } */
  /* #swagger.responses[200] = {
        description: 'WASSCE bulk campaign processed successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        message: { type: "string" },
                        data: {
                            type: "object",
                            properties: {
                                totalRecipients: { type: "integer" },
                                successCount: { type: "integer" },
                                failedCount: { type: "integer" }
                            }
                        }
                    }
                }
            }
        }
     }
  */
  const { recipientType, title, body } = req.body;
  return executeBulkSMSByVoucherType({
    voucherType: 'WASSCE_NOVDEC',
    recipientType,
    title,
    body,
    req,
    res,
    next
  });
};

/**
 * Send general bulk SMS campaign
 * POST /api/admin/sms/bulk
 */
export const sendBulkSMS = async (req, res, next) => {
  // #swagger.tags = ['SMS Campaigns']
  // #swagger.summary = 'Send bulk SMS campaign (Legacy / General)'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { recipientType, title, body } = req.body;

    if (!recipientType || !body) {
      throw new AppError('Recipient division and message body are required.', 400);
    }

    const upperType = recipientType.toUpperCase();

    // The legacy division options name a product, not a payment status. They mean
    // "everyone who touched that product", so rewrite the segment to one the
    // per-product handler understands - it rejected "BECE" outright before.
    // The request object itself is passed along: spreading it would drop the
    // prototype getters (req.ip among them) that activity logging relies on.
    const legacyProduct = VOUCHER_TYPES.find(
      (type) => upperType === type || upperType === `${type}_ONLY`
    );
    if (legacyProduct) {
      req.body.recipientType = 'ALL';
      return executeBulkSMSByVoucherType({
        voucherType: legacyProduct,
        recipientType: 'ALL',
        title,
        body,
        req,
        res,
        next
      });
    }

    if (!RECIPIENT_TYPES.includes(upperType)) {
      throw new AppError(
        `Invalid recipientType. Must be ${[...RECIPIENT_TYPES, ...VOUCHER_TYPES].join(', ')}.`,
        400
      );
    }

    // No voucherType: every product
    const { recipients, duplicatesMerged, unusable } = await buildSmsRecipients({
      recipientType: upperType
    });

    if (recipients.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No recipient contacts found matching the selected division.',
        data: {
          totalRecipients: 0,
          successCount: 0,
          failedCount: 0
        }
      });
    }

    const successSent = [];
    const failedSent = [];
    const smsMessage = title && title.trim() !== '' ? `${title.trim()}\n\n${body.trim()}` : body;

    const batchSize = 100;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const resSend = await sendBatchSMS({ recipients: batch, message: smsMessage });
      if (resSend.success) {
        successSent.push(...batch);
      } else {
        batch.forEach(phone => {
          failedSent.push({ phone, error: resSend.error || 'Batch failed' });
        });
      }
    }

    logActivity({
      userId: req.user.id,
      action: 'SMS_BULK_SEND',
      details: {
        recipientType: upperType,
        totalRecipients: recipients.length,
        duplicatesMerged,
        unusable,
        successCount: successSent.length,
        failedCount: failedSent.length,
        title: title || '',
        body
      },
      req
    });

    notifyAllAdmins({
      title: 'SMS Campaign Sent',
      message: `SMS campaign (${upperType}) was sent to ${recipients.length} customers by ${req.user.fullName || req.user.email || 'an Admin'}.`,
      type: 'SMS',
      sendPush: false
    }).catch(err => console.error('Failed to notify admins of bulk SMS:', err));

    res.status(200).json({
      success: true,
      message: `Bulk SMS campaign completed. Sent: ${successSent.length}, Failed: ${failedSent.length}`,
      data: {
        totalRecipients: recipients.length,
        successCount: successSent.length,
        failedCount: failedSent.length
      }
    });
  } catch (error) {
    console.error('Error in sendBulkSMS:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while sending bulk SMS.', 500));
    }
  }
};

/**
 * Send customized SMS directly to a specific phone number
 * POST /api/admin/sms/single
 */
export const sendSingleSMS = async (req, res, next) => {
  // #swagger.tags = ['SMS Campaigns']
  // #swagger.summary = 'Send custom single SMS'
  // #swagger.description = 'Dispatches a custom direct SMS to a specific phone number. Note: The recipient phone number can be any custom number, and does not need to exist in the database.'
  // #swagger.security = [{"bearerAuth": []}]
  /* #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        phoneNumber: {
                            type: "string",
                            description: "Recipient phone number"
                        },
                        title: {
                            type: "string",
                            description: "SMS subject line or campaign identifier for logs"
                        },
                        body: {
                            type: "string",
                            description: "SMS message text body"
                        }
                    },
                    required: ["phoneNumber", "body"]
                }
            }
        }
     } */
  /* #swagger.responses[200] = {
        description: 'SMS dispatched successfully',
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    properties: {
                        success: { type: "boolean", example: true },
                        message: { type: "string" }
                    }
                }
            }
        }
     }
  */
  try {
    const { phoneNumber, title, body } = req.body;

    if (!phoneNumber || !body) {
      throw new AppError('Recipient phone number and message body are required.', 400);
    }

    const smsMessage = title && title.trim() !== '' ? `${title.trim()}\n\n${body.trim()}` : body;

    const sendRes = await sendSMS({ to: phoneNumber, message: smsMessage });

    if (!sendRes.success) {
      throw new AppError(`Failed to send SMS to ${phoneNumber}. Reason: ${sendRes.error || 'Unknown Gateway Error'}`, 500);
    }

    logActivity({
      userId: req.user.id,
      action: 'SMS_SINGLE_SEND',
      details: {
        phoneNumber,
        title: title || '',
        body
      },
      req
    });

    notifyAllAdmins({
      title: 'Single SMS Sent',
      message: `SMS sent directly to ${phoneNumber} by ${req.user.name || 'an Admin'}.`,
      type: 'SMS',
      sendPush: false
    }).catch(err => console.error('Failed to notify admins of single SMS:', err));

    res.status(200).json({
      success: true,
      message: `SMS successfully sent to ${phoneNumber}.`
    });
  } catch (error) {
    console.error('Error in sendSingleSMS:', error);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while sending single SMS.', 500));
    }
  }
};

export const sendCtvetNabtexBulkSMS = async (req, res, next) => {
  // #swagger.tags = ['SMS Campaigns']
  // #swagger.summary = 'Send CTVET/NABTEX bulk SMS campaign'
  // #swagger.description = 'Dispatches an SMS campaign to CTVET/NABTEX customers. Division options: ALL, SUCCESSFUL, FAILED_ONLY.'
  // #swagger.security = [{"bearerAuth": []}]
  const { recipientType, title, body } = req.body;
  return executeBulkSMSByVoucherType({
    voucherType: 'CTVET_NABTEX',
    recipientType,
    title,
    body,
    req,
    res,
    next
  });
};

/**
 * Reports how many people a campaign would reach, using the same builder the
 * send path uses — so the figure the admin approves is the list that goes out.
 * Previously the page guessed this client-side from voucher sales counts.
 */
export const getBulkSMSRecipientCount = async (req, res, next) => {
  // #swagger.tags = ['SMS Campaigns']
  // #swagger.summary = 'Count the recipients a bulk SMS campaign would reach'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { recipientType, voucherType } = req.query;

    const segment = String(recipientType || 'ALL').toUpperCase();
    if (!RECIPIENT_TYPES.includes(segment)) {
      throw new AppError(`Invalid recipientType. Must be ${RECIPIENT_TYPES.join(', ')}.`, 400);
    }

    // Omitted means every product; anything else must name a real one
    let scopedVoucherType = null;
    if (voucherType && voucherType !== 'ALL') {
      if (!VOUCHER_TYPES.includes(voucherType)) {
        throw new AppError(`Invalid voucherType. Must be one of ${VOUCHER_TYPES.join(', ')}, or omitted.`, 400);
      }
      scopedVoucherType = voucherType;
    }

    const { recipients, sourceRows, duplicatesMerged, unusable } = await buildSmsRecipients({
      voucherType: scopedVoucherType,
      recipientType: segment
    });

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Recipient count calculated.',
      data: {
        totalRecipients: recipients.length,
        sourceRows,
        duplicatesMerged,
        unusable,
        recipientType: segment,
        voucherType: scopedVoucherType
      }
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError('Could not calculate the recipient count.', 500));
  }
};

/**
 * Per-type contact counts and when each was last cleared, for the admin screen.
 */
export const getSmsContactSummary = async (req, res, next) => {
  // #swagger.tags = ['SMS Campaigns']
  // #swagger.summary = 'Contact counts per voucher type, and last clearance'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const summary = await smsContactSummary();
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Contact summary calculated.',
      data: summary
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError('Could not load the contact summary.', 500));
  }
};

/**
 * Clears the SMS contact list so new contacts can accumulate.
 *
 * Pass ?voucherType= to clear one product, or omit it to clear every type.
 * USSD dialer rows are deleted; orders are kept and their contacts are put
 * behind a cut-off. Nothing financial is removed.
 */
export const clearSmsContactList = async (req, res, next) => {
  // #swagger.tags = ['SMS Campaigns']
  // #swagger.summary = 'Clear SMS contacts (all, or one voucher type)'
  // #swagger.description = 'Deletes USSD dialer records and puts order-derived contacts behind a cut-off. Orders themselves are never deleted.'
  // #swagger.security = [{"bearerAuth": []}]
  try {
    const { voucherType } = req.query;

    let scopedVoucherType = null;
    if (voucherType && voucherType !== 'ALL') {
      if (!VOUCHER_TYPES.includes(voucherType)) {
        throw new AppError(`Invalid voucherType. Must be one of ${VOUCHER_TYPES.join(', ')}, ALL, or omitted.`, 400);
      }
      scopedVoucherType = voucherType;
    }

    const result = await clearSmsContacts({
      voucherType: scopedVoucherType,
      userId: req.user.id
    });

    const label = scopedVoucherType ? displayNameFor(scopedVoucherType) : 'all voucher types';

    logActivity({
      userId: req.user.id,
      action: 'SMS_CONTACTS_CLEARED',
      details: {
        voucherType: scopedVoucherType,
        contactsBefore: result.contactsBefore,
        contactsAfter: result.contactsAfter,
        dialersDeleted: result.dialersDeleted,
        ordersExcluded: result.ordersExcluded
      },
      req
    });

    notifyAllAdmins({
      title: 'SMS Contacts Cleared',
      message: `${req.user.fullName || req.user.email || 'An admin'} cleared the SMS contact list for ${label}. ${result.contactsBefore} contact(s) removed; orders were not deleted.`,
      type: 'SMS',
      sendPush: false
    }).catch(err => console.error('Failed to notify admins of contact clearance:', err));

    return res.status(200).json({
      success: true,
      status: 200,
      message: `Cleared ${result.contactsBefore} contact(s) for ${label}. New contacts will start collecting from now.`,
      data: result
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    if (/Unknown voucher type/.test(error.message)) return next(new AppError(error.message, 400));
    return next(new AppError('Could not clear the contact list.', 500));
  }
};
