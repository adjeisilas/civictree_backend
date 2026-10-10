import { checkHubtelTransactionStatus } from './hubtelHelper.js';

const AMOUNT_TOLERANCE = 0.01;

/**
 * Confirms an order's payment directly with Hubtel's Transaction Status Check API.
 *
 * Callback and fulfillment payloads can be forged by anyone who can reach our endpoints,
 * so this check is the ONLY thing allowed to decide that an order was paid.
 *
 * USSD orders can be paid either through our direct debit prompt (client reference = order ID)
 * or through Hubtel's USSD checkout (client reference = USSD SessionId, which is stored in
 * order.transactionId until the order is fulfilled), so both references are checked.
 *
 * @param {Object} order - Order record (needs id, amount, channel, transactionId)
 * @returns {Promise<Object>} One of:
 *   { outcome: 'PAID', transactionId, amountPaid, reference }
 *   { outcome: 'AMOUNT_MISMATCH', amountPaid, expectedAmount, reference }
 *   { outcome: 'NOT_PAID', statuses }   - Hubtel answered for every reference and none is Paid
 *   { outcome: 'UNKNOWN', statuses, error } - at least one check failed and none is Paid
 */
export const verifyOrderPayment = async (order) => {
  const references = [order.id];
  if (order.channel === 'USSD' && order.transactionId && order.transactionId !== order.id) {
    references.push(order.transactionId);
  }

  const expectedAmount = Number(order.amount);
  const statuses = [];
  let lastError = null;
  let mismatch = null;

  for (const reference of references) {
    const result = await checkHubtelTransactionStatus(reference);

    if (!result.success) {
      lastError = result.error || 'Status check failed';
      continue;
    }

    if (!result.status) {
      lastError = 'Hubtel returned no transaction status';
      continue;
    }

    statuses.push(result.status);

    if (result.status !== 'Paid') continue;

    const amountPaid = Number(result.amount);
    if (!Number.isFinite(amountPaid) || amountPaid + AMOUNT_TOLERANCE < expectedAmount) {
      mismatch = { outcome: 'AMOUNT_MISMATCH', amountPaid, expectedAmount, reference };
      continue;
    }

    return {
      outcome: 'PAID',
      transactionId: result.transactionId || null,
      amountPaid,
      reference
    };
  }

  if (mismatch) return mismatch;
  if (lastError) return { outcome: 'UNKNOWN', statuses, error: lastError };
  return { outcome: 'NOT_PAID', statuses };
};

/**
 * Runs verifyOrderPayment a few times with short pauses. Hubtel's status API can lag
 * a few seconds behind its own callbacks, so a single check right after a callback
 * may not see the payment yet.
 *
 * @param {Object} order
 * @param {number[]} [delaysMs] - Pauses before each retry
 */
const DEFAULT_RETRY_DELAYS_MS = (process.env.PAYMENT_VERIFY_RETRY_DELAYS_MS || '3000,6000,10000')
  .split(',')
  .map((ms) => parseInt(ms, 10))
  .filter((ms) => Number.isFinite(ms) && ms >= 0);

export const verifyOrderPaymentWithRetry = async (order, delaysMs = DEFAULT_RETRY_DELAYS_MS) => {
  let verification = await verifyOrderPayment(order);
  for (const delay of delaysMs) {
    if (verification.outcome === 'PAID' || verification.outcome === 'AMOUNT_MISMATCH') break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    verification = await verifyOrderPayment(order);
  }
  return verification;
};
