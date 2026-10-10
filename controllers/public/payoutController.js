import { AppError } from '../../utils/error/AppError.js';
import { settlePayoutByReference } from '../../utils/payment/payoutReconciler.js';

/**
 * Receives Hubtel's Send Money (payout) callback.
 * The body only tells us which payout to look at; the outcome is confirmed with Hubtel's
 * status API before any record is updated.
 */
export const hubtelPayoutWebhook = async (req, res, next) => {
  // #swagger.ignore = true
  try {
    const payload = req.body || {};
    const clientReference = payload.ClientReference || payload.Data?.ClientReference || payload.clientReference;
    const reportedCode = payload.ResponseCode || payload.Data?.ResponseCode;

    console.log(`[HUBTEL PAYOUT CALLBACK] ClientReference: ${clientReference}, ResponseCode: ${reportedCode}`);

    if (!clientReference) {
      throw new AppError('Missing ClientReference from Hubtel payout callback.', 400);
    }

    const result = await settlePayoutByReference(clientReference, { req });

    console.log(`[HUBTEL PAYOUT CALLBACK] ${clientReference}: ${result.handled ? result.outcome : `not settled (${result.reason})`}`);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.log('[HUBTEL PAYOUT CALLBACK ERROR]', error.message);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred while processing the payout callback.', 500));
    }
  }
};
