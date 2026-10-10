import { prisma } from '../../config/config.js';
import { sendUssdFulfillmentCallback } from '../payment/hubtelHelper.js';
import { verifyOrderPayment } from '../payment/verifyOrderPayment.js';
import { applyPaymentVerification } from '../../controllers/public/orderController.js';

// Hubtel requires the fulfillment callback within one hour of its fulfillment request.
// These pauses add up to 54 minutes.
const FOLLOW_UP_DELAYS_MS = [1, 3, 5, 10, 15, 20].map((minutes) => minutes * 60 * 1000);

const sendFinalCallback = async ({ paymentStatus, sessionId, hubtelOrderId }) => {
  if (paymentStatus === 'SUCCESS') {
    await sendUssdFulfillmentCallback({ sessionId, orderId: hubtelOrderId, status: 'success' });
    return true;
  }
  if (paymentStatus === 'FAILED') {
    await sendUssdFulfillmentCallback({ sessionId, orderId: hubtelOrderId, status: 'failed' });
    return true;
  }
  return false;
};

/**
 * Keeps checking a USSD order whose payment Hubtel's status API could not yet confirm when the
 * fulfillment request arrived. Once the payment is confirmed (or fails), the order is settled and
 * Hubtel's fulfillment callback is sent.
 *
 * Runs in-process: if the server restarts, the reconciliation cron job still fulfills the order,
 * but no fulfillment callback is sent to Hubtel for it.
 *
 * @param {Object} params
 * @param {string} params.orderId - Our order ID
 * @param {string} params.sessionId - USSD SessionId from Hubtel
 * @param {string} params.hubtelOrderId - OrderId from Hubtel's fulfillment request
 */
export const scheduleUssdFulfillmentFollowUp = ({ orderId, sessionId, hubtelOrderId }) => {
  let attempt = 0;

  const runNext = () => {
    if (attempt >= FOLLOW_UP_DELAYS_MS.length) {
      console.warn(`[USSD FOLLOW-UP] Gave up confirming payment for order ${orderId} within Hubtel's callback window.`);
      return;
    }

    const delay = FOLLOW_UP_DELAYS_MS[attempt];
    attempt += 1;

    const timer = setTimeout(async () => {
      try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return;

        // Settled elsewhere (e.g. by the reconciliation job) — just tell Hubtel
        if (await sendFinalCallback({ paymentStatus: order.paymentStatus, sessionId, hubtelOrderId })) {
          return;
        }

        const verification = await verifyOrderPayment(order);
        const result = await applyPaymentVerification({
          order,
          verification,
          req: null,
          source: 'USSD_FOLLOW_UP'
        });

        console.log(`[USSD FOLLOW-UP] Order ${orderId} attempt ${attempt}: verification ${verification.outcome}, payment status ${result.paymentStatus}`);

        if (!(await sendFinalCallback({ paymentStatus: result.paymentStatus, sessionId, hubtelOrderId }))) {
          runNext();
        }
      } catch (error) {
        console.error(`[USSD FOLLOW-UP] Error while checking order ${orderId}:`, error.message);
        runNext();
      }
    }, delay);

    // Don't keep the process alive just for a pending follow-up (e.g. during shutdown)
    timer.unref();
  };

  runNext();
};
