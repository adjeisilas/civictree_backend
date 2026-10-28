import { prisma } from '../../config/config.js';
import { commissionFrom, displayNameFor, resultsUrlFor } from '../../utils/voucher/voucherTypes.js';
import { AppError } from '../../utils/error/AppError.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import { initiateHubtelCheckout } from '../../utils/payment/hubtelHelper.js';
import { verifyOrderPayment, verifyOrderPaymentWithRetry } from '../../utils/payment/verifyOrderPayment.js';
import { generateOrderId, MAX_VOUCHERS_PER_ORDER } from '../../utils/order/orderHelpers.js';
import { readPin } from '../../utils/voucher/voucherPin.js';
import { sendSMS } from '../../utils/sms/smsHelper.js';
import { notifyAllAdmins } from '../../utils/notification/pushHelper.js';

/**
 * Controller for initiating a voucher purchase order.
 */
export const createOrder = async (req, res, next) => {
  // #swagger.tags = ['Orders']
  // #swagger.summary = 'Initiate Voucher Purchase Order'
  // #swagger.description = 'Creates a pending order and returns the Hubtel unified checkout payment gateway URL.'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateOrderRequest" }
          }
        }
     }
  */
  /* #swagger.responses[201] = {
        description: 'Order initiated successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateOrderResponse" }
          }
        }
     }
  */
  /* #swagger.responses[400] = {
        description: 'Bad Request',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
     }
  */
  /* #swagger.responses[500] = {
        description: 'Server Error',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
     }
  */
  try {
    const { voucherType, quantity, phoneNumber, customerName } = req.body;

    // 1. Parameter Validation
    if (!voucherType || !['WASSCE_NOVDEC', 'BECE'].includes(voucherType)) {
      throw new AppError('Invalid voucher type. Must be WASSCE_NOVDEC or BECE.', 400);
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      throw new AppError('Quantity must be a positive integer.', 400);
    }

    if (qty > MAX_VOUCHERS_PER_ORDER) {
      throw new AppError(`You can buy at most ${MAX_VOUCHERS_PER_ORDER} vouchers per order.`, 400);
    }

    if (!phoneNumber) {
      throw new AppError('Phone number is required for voucher SMS delivery.', 400);
    }

    // Orders created here are always web checkouts; USSD orders are created by the USSD handlers
    const orderChannel = 'WEB';

    // 2. Check stock levels
    const availableStock = await prisma.voucher.count({
      where: {
        type: voucherType,
        status: 'AVAILABLE'
      }
    });

    if (availableStock < qty) {
      throw new AppError(`Insufficient stock. Only ${availableStock} vouchers are available for ${voucherType}.`, 400);
    }

    // 3. Calculate amount from configuration
    const config = await prisma.voucherConfig.findFirst();
    if (!config) {
      throw new AppError('Voucher system pricing is not configured. Please contact administration.', 500);
    }

    let unitPrice = 0;
    if (voucherType === 'WASSCE_NOVDEC') unitPrice = config.wassceNovdecPrice;
    else if (voucherType === 'BECE') unitPrice = config.becePrice;

    // Calculate actual base voucher price to store in DB
    const baseAmount = Number(unitPrice) * qty;

    // Calculate total amount to charge customer (base voucher price)
    const totalAmountToCharge = baseAmount;

    // 4. Generate order reference ID (#CT-1001 sequential with unique random suffix to prevent Hubtel duplicate reference error)
    const orderId = await generateOrderId();

    // 5. Create Order record in DB (PENDING) - Store actual base amount
    const order = await prisma.order.create({
      data: {
        id: orderId,
        customerName: customerName || null,
        phoneNumber,
        voucherType,
        quantity: qty,
        amount: baseAmount,
        channel: orderChannel,
        paymentStatus: 'PENDING',
        deliveryStatus: 'NOT_SENT'
      }
    });

    logActivity({
      action: 'ORDER_INITIATED',
      details: { orderId, voucherType, quantity: qty, baseAmount, totalAmountToCharge },
      req
    });

    // 6. Call Hubtel gateway helper with total amount including 1.8% fee
    let checkoutInfo;
    try {
      checkoutInfo = await initiateHubtelCheckout({
        orderId,
        amount: totalAmountToCharge,
        phoneNumber,
        customerName,
        voucherType,
        quantity: qty
      });
    } catch (checkoutError) {
      // If payment initiation fails, log and delete/fail the order record so stock is not blocked
      await prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'FAILED' }
      });
      throw new AppError(checkoutError.message || 'Payment initiation failed', 500);
    }

    // 7. Update order with payment transaction identifier from Hubtel
    await prisma.order.update({
      where: { id: orderId },
      data: { transactionId: checkoutInfo.transactionId }
    });

    return res.status(201).json({
      success: true,
      message: 'Order initiated successfully. Redirect to checkout URL to complete payment.',
      data: {
        orderId,
        checkoutUrl: checkoutInfo.checkoutUrl,
        amount: totalAmountToCharge,
        quantity: qty,
        voucherType
      }
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError(error.message || 'An unexpected error occurred during order creation.', 500));
    }
  }
};

const MAX_ALLOCATION_ATTEMPTS = 5;

class VoucherAllocationConflict extends Error {}

/**
 * Builds the SMS that delivers voucher codes to the customer.
 */
const buildVoucherSms = (order, vouchers) => {
  const voucherListStr = vouchers
    .map((v, i) => `${i + 1}. Serial Number: ${v.serialNumber}\n   PIN: ${readPin(v.pin)}`)
    .join('\n');

  // A type with no configured portal gets no link rather than another body's
  const checkLink = resultsUrlFor(order.voucherType);
  const linkLine = checkLink ? `\nCheck results here: ${checkLink}` : '';

  return `CivicTree: Thank you! Order: ${order.id}.\nHere are your ${displayNameFor(order.voucherType)} voucher codes:\n${voucherListStr}${linkLine}`;
};

/**
 * Credits the affiliate who referred a fulfilled order (GHS per voucher from AffiliateConfig).
 */
const creditAffiliateCommission = async (order, req) => {
  const affiliateConfig = await prisma.affiliateConfig.findFirst();

  // Looked up per type. The previous two-way check paid any type that was not
  // BECE at the WASSCE rate, so a third type would have been mispriced.
  const commissionPerUnit = commissionFrom(affiliateConfig, order.voucherType);
  const commissionAmount = commissionPerUnit * order.quantity;

  // Record Affiliate Commission (Unique per order)
  await prisma.affiliateCommission.upsert({
    where: { orderId: order.id },
    update: { amount: commissionAmount },
    create: {
      affiliateId: order.affiliateId,
      orderId: order.id,
      voucherType: order.voucherType,
      amount: commissionAmount
    }
  });

  // Update Affiliate Profile stats
  await prisma.affiliateProfile.update({
    where: { id: order.affiliateId },
    data: {
      totalVouchersSold: { increment: order.quantity },
      totalSalesGenerated: { increment: order.amount }
    }
  });

  logActivity({
    action: 'AFFILIATE_SALE_COMPLETED',
    details: {
      affiliateId: order.affiliateId,
      orderId: order.id,
      voucherType: order.voucherType,
      quantity: order.quantity,
      commissionAmount
    },
    req
  });
};

/**
 * Accrues real-time revenue-share partner earnings (GHS 1.00 per voucher sold across all channels).
 */
const accruePartnerRevenueShare = async (order) => {
  const activePartners = await prisma.partner.findMany({
    where: { status: 'Active' }
  });

  for (const partner of activePartners) {
    const perVoucherCut = 1.00; // Contract rate: GHS 1.00 per voucher
    const partnerEarning = perVoucherCut * order.quantity;
    const unitPrice = order.quantity > 0 ? Number(order.amount) / order.quantity : Number(order.amount);
    const netMargin = Math.max(1, unitPrice - 15);
    const dynamicSharePercentage = parseFloat(((perVoucherCut / netMargin) * 100).toFixed(2));

    // Create ledger transaction entry (idempotent check by orderId)
    const existingTx = await prisma.partnerTransaction.findFirst({
      where: { partnerId: partner.id, orderId: order.id }
    });

    if (!existingTx) {
      await prisma.partnerTransaction.create({
        data: {
          partnerId: partner.id,
          orderId: order.id,
          orderRef: order.id,
          voucherType: order.voucherType,
          quantity: order.quantity,
          unitPrice: unitPrice,
          grossAmount: order.amount,
          partnerPercentage: dynamicSharePercentage,
          partnerEarning: partnerEarning,
          channel: order.channel === 'USSD' ? 'USSD *713*5912#' : 'Web Direct',
          paymentMethod: 'Mobile Money',
          settlementStatus: 'Accrued'
        }
      });

      // Increment partner balances
      await prisma.partner.update({
        where: { id: partner.id },
        data: {
          availableBalance: { increment: partnerEarning },
          lifetimeShareEarnings: { increment: partnerEarning }
        }
      });
    }
  }
};

/**
 * Fulfills a PAID voucher order: allocates vouchers, sends the delivery SMS, updates statuses,
 * credits affiliate commission and partner revenue share, and notifies admins.
 *
 * Callers MUST confirm the payment with verifyOrderPayment() first — never on the word of a callback payload.
 *
 * Safe to call concurrently: claiming the order (PENDING -> SUCCESS) and allocating vouchers happen in
 * one transaction, so only one caller can ever fulfill a given order, and a voucher can only be sold once.
 *
 * @param {Object} params
 * @param {string} params.orderId - The database order ID
 * @param {string} [params.transactionId] - The payment transaction identifier
 * @param {Object} [params.req] - Express request object (optional, for logger context)
 * @returns {Promise<Object>} { success, fulfilled, outOfStock, message } — fulfilled is true only for
 *   the call that actually processed the order.
 */
export const completeOrderFulfillment = async ({ orderId, transactionId, req }) => {
  let allocation = null;

  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt++) {
    try {
      allocation = await prisma.$transaction(async (tx) => {
        // Claim the order. The row lock makes a concurrent caller wait here and then match nothing.
        const claimed = await tx.order.updateMany({
          where: { id: orderId, paymentStatus: 'PENDING' },
          data: { paymentStatus: 'SUCCESS', ...(transactionId ? { transactionId } : {}) }
        });

        if (claimed.count !== 1) {
          const existing = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
          if (!existing) {
            throw new Error(`Order with ID ${orderId} not found.`);
          }
          return { alreadyProcessed: true };
        }

        const order = await tx.order.findUnique({ where: { id: orderId } });

        const candidates = await tx.voucher.findMany({
          where: { type: order.voucherType, status: 'AVAILABLE' },
          select: { id: true },
          take: order.quantity
        });

        // Paid but out of stock: keep the payment recorded and flag delivery as failed
        if (candidates.length < order.quantity) {
          await tx.order.update({
            where: { id: orderId },
            data: { deliveryStatus: 'FAILED' }
          });
          return { order, vouchers: [], outOfStock: true };
        }

        const voucherIds = candidates.map((v) => v.id);

        // Only take vouchers that are still AVAILABLE. If another order took one first, retry.
        const taken = await tx.voucher.updateMany({
          where: { id: { in: voucherIds }, status: 'AVAILABLE' },
          data: { status: 'SOLD', orderId }
        });

        if (taken.count !== voucherIds.length) {
          throw new VoucherAllocationConflict();
        }

        const vouchers = await tx.voucher.findMany({ where: { id: { in: voucherIds } } });
        return { order, vouchers, outOfStock: false };
      }, {
        // Bursts of callbacks queue on the order row lock; wait rather than fail the delivery
        maxWait: 15000,
        timeout: 20000
      });
      break;
    } catch (err) {
      if (err instanceof VoucherAllocationConflict && attempt < MAX_ALLOCATION_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }

  if (allocation.alreadyProcessed) {
    return {
      success: true,
      fulfilled: false,
      outOfStock: false,
      message: 'Order was already processed.'
    };
  }

  const { order, vouchers, outOfStock } = allocation;

  if (outOfStock) {
    logActivity({
      action: 'ORDER_FULFILLMENT_OUT_OF_STOCK',
      details: { orderId: order.id, voucherType: order.voucherType, quantity: order.quantity },
      req
    });

    notifyAllAdmins({
      title: 'Paid order not delivered: out of stock',
      message: `Order ${order.id} (${order.quantity}x ${order.voucherType}, GHS ${order.amount}) was paid, but there were not enough vouchers. Add stock and resend, or refund the customer.`,
      type: 'ORDER',
      sendPush: true
    }).catch(err => console.error('Failed to notify admins of out-of-stock order:', err));

    return {
      success: true,
      fulfilled: true,
      outOfStock: true,
      message: 'Payment verified but voucher stock was exhausted. Order delivery status set to FAILED.'
    };
  }

  // Send SMS via the helper
  const smsResult = await sendSMS({
    to: order.phoneNumber,
    message: buildVoucherSms(order, vouchers)
  });

  const deliveryStatus = smsResult.success ? 'SENT' : 'FAILED';

  await prisma.order.update({
    where: { id: order.id },
    data: { deliveryStatus }
  });

  logActivity({
    action: 'ORDER_PAYMENT_SUCCESS',
    details: { orderId: order.id, transactionId: order.transactionId, deliveryStatus },
    req
  });

  // Notify all admins and trigger push notification
  notifyAllAdmins({
    title: 'New Successful Order',
    message: `Order ${order.id} for ${order.quantity}x ${order.voucherType} (GHS ${order.amount}) was paid successfully. SMS Delivery: ${deliveryStatus}.`,
    type: 'ORDER',
    sendPush: true
  }).catch(err => console.error('Failed to notify admins of order success:', err));

  if (order.affiliateId) {
    try {
      await creditAffiliateCommission(order, req);
    } catch (affiliateErr) {
      console.error('Failed to credit affiliate commission for order:', order.id, affiliateErr);
    }
  }

  try {
    await accruePartnerRevenueShare(order);
  } catch (partnerErr) {
    console.error('Failed to process partner revenue share for order:', order.id, partnerErr);
  }

  return {
    success: true,
    fulfilled: true,
    outOfStock: false,
    message: 'Order payment verified and vouchers processed.'
  };
};

/**
 * Acts on the result of verifyOrderPayment() for a PENDING order.
 *
 * - PAID: fulfill the order.
 * - AMOUNT_MISMATCH: mark FAILED and alert admins (someone paid less than the order total).
 * - NOT_PAID: mark FAILED when Hubtel reports a final non-paid status (e.g. Refunded), or when the order
 *   is still Unpaid and older than failUnpaidOlderThanMs. Otherwise leave it PENDING.
 * - UNKNOWN: leave PENDING; the reconciliation job checks again later.
 *
 * @param {Object} params
 * @param {Object} params.order - The PENDING order
 * @param {Object} params.verification - Result of verifyOrderPayment()
 * @param {Object} [params.req] - Express request (for activity log context)
 * @param {string} params.source - Where the check came from (for the activity log)
 * @param {number} [params.failUnpaidOlderThanMs] - Age after which an Unpaid order is marked FAILED
 * @returns {Promise<Object>} { success, fulfilled, paymentStatus, message }
 */
export const applyPaymentVerification = async ({ order, verification, req, source, failUnpaidOlderThanMs }) => {
  if (verification.outcome === 'PAID') {
    const result = await completeOrderFulfillment({
      orderId: order.id,
      transactionId: verification.transactionId,
      req
    });
    return { ...result, paymentStatus: 'SUCCESS' };
  }

  if (verification.outcome === 'AMOUNT_MISMATCH') {
    await prisma.order.updateMany({
      where: { id: order.id, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'FAILED' }
    });

    logActivity({
      action: 'ORDER_PAYMENT_AMOUNT_MISMATCH',
      details: {
        orderId: order.id,
        expectedAmount: verification.expectedAmount,
        amountPaid: verification.amountPaid,
        source
      },
      req
    });

    notifyAllAdmins({
      title: 'Payment amount mismatch',
      message: `Order ${order.id} expected GHS ${verification.expectedAmount} but Hubtel reports GHS ${verification.amountPaid}. The order was not fulfilled.`,
      type: 'ORDER',
      sendPush: true
    }).catch(err => console.error('Failed to notify admins of amount mismatch:', err));

    return {
      success: false,
      fulfilled: false,
      paymentStatus: 'FAILED',
      message: 'The amount paid does not match the order total.'
    };
  }

  if (verification.outcome === 'NOT_PAID') {
    const stillUnpaid = verification.statuses.every((status) => status === 'Unpaid');
    const isTooOld = Boolean(failUnpaidOlderThanMs) &&
      Date.now() - new Date(order.createdAt).getTime() > failUnpaidOlderThanMs;

    if (!stillUnpaid || isTooOld) {
      await prisma.order.updateMany({
        where: { id: order.id, paymentStatus: 'PENDING' },
        data: { paymentStatus: 'FAILED' }
      });

      logActivity({
        action: 'ORDER_PAYMENT_FAILED',
        details: { orderId: order.id, hubtelStatuses: verification.statuses, source },
        req
      });

      return {
        success: false,
        fulfilled: false,
        paymentStatus: 'FAILED',
        message: 'Payment was not completed for this order.'
      };
    }

    return {
      success: false,
      fulfilled: false,
      paymentStatus: 'PENDING',
      message: 'Payment is still pending verification.'
    };
  }

  return {
    success: false,
    fulfilled: false,
    paymentStatus: 'PENDING',
    message: 'Payment could not be verified yet. It will be checked again shortly.'
  };
};

/**
 * Controller for receiving Hubtel Payment Webhook callback notifications.
 * The callback body is treated only as a signal to check: the payment is confirmed with Hubtel's status API.
 */
export const hubtelWebhook = async (req, res, next) => {
  // #swagger.ignore = true
  try {
    const payload = req.body || {};

    // Handle nested or flat Hubtel payload formats
    const clientReference = payload.ClientReference || payload.Data?.ClientReference || payload.clientReference;
    const reportedCode = payload.ResponseCode || payload.Data?.ResponseCode || payload.responseCode;
    const reportedStatus = payload.Status || payload.Data?.Status || payload.status;

    console.log(`[HUBTEL WEBHOOK] ClientReference: ${clientReference}, ResponseCode: ${reportedCode}, Status: ${reportedStatus}`);

    if (!clientReference || typeof clientReference !== 'string') {
      throw new AppError('Missing ClientReference from Hubtel callback payload.', 400);
    }

    const order = await prisma.order.findUnique({
      where: { id: clientReference }
    });

    if (!order) {
      throw new AppError('Order not found.', 404);
    }

    // If order has already been finalized (SUCCESS or FAILED), exit idempotently
    if (order.paymentStatus !== 'PENDING') {
      return res.status(200).json({
        success: true,
        message: 'Order was already processed.'
      });
    }

    const verification = await verifyOrderPaymentWithRetry(order);

    const callbackClaimedSuccess = ['0000', '00'].includes(reportedCode) || ['Success', 'SUCCESS'].includes(reportedStatus);
    if (callbackClaimedSuccess && verification.outcome !== 'PAID') {
      logActivity({
        action: 'ORDER_PAYMENT_CALLBACK_UNCONFIRMED',
        details: { orderId: order.id, reportedCode, reportedStatus, verification: verification.outcome },
        req
      });
    }

    const result = await applyPaymentVerification({
      order,
      verification,
      req,
      source: 'HUBTEL_WEBHOOK'
    });

    console.log(`[HUBTEL WEBHOOK] Order ${order.id}: verification ${verification.outcome}, payment status ${result.paymentStatus}`);

    return res.status(200).json({ success: result.success, message: result.message });
  } catch (error) {
    console.log('[HUBTEL WEBHOOK ERROR]', error.message);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred during webhook processing.', 500));
    }
  }
};


/**
 * Controller to verify the payment status of an order.
 * Queries local DB first, then checks Hubtel API to ensure real-time accuracy and triggers fulfillment if success.
 */
export const verifyPaymentStatus = async (req, res, next) => {
  // #swagger.tags = ['Orders']
  // #swagger.summary = 'Verify Payment Status'
  // #swagger.description = 'Checks order status in DB, queries Hubtel status API, and processes fulfillment if paid.'
  // #swagger.parameters['checkoutid'] = { in: 'query', description: 'The Hubtel checkout ID or Order ID' }
  /* #swagger.responses[200] = {
        description: 'Payment status verified successfully',
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/VerifyPaymentResponse" }
          }
        }
     }
  */
  try {
    const orderId = req.query.checkoutid || req.query.orderId || req.query.id;

    if (!orderId || typeof orderId !== 'string') {
      throw new AppError('checkoutid query parameter is required.', 400);
    }

    // Search by either order ID (e.g. #CT-1001) or Hubtel checkout ID (transactionId)
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { id: orderId },
          { transactionId: orderId }
        ]
      }
    });

    if (!order) {
      throw new AppError('Order not found.', 404);
    }

    // 1. If DB already records SUCCESS, immediately return success
    if (order.paymentStatus === 'SUCCESS') {
      return res.status(200).json({
        success: true,
        status: 'SUCCESS',
        message: 'Payment verified successfully.',
        data: {
          orderId: order.id,
          paymentStatus: order.paymentStatus,
          deliveryStatus: order.deliveryStatus
        }
      });
    }

    // 2. If DB records FAILED, return failure
    if (order.paymentStatus === 'FAILED') {
      return res.status(200).json({
        success: false,
        status: 'FAILED',
        message: 'Payment failed for this order.',
        data: {
          orderId: order.id,
          paymentStatus: order.paymentStatus
        }
      });
    }

    // 3. If PENDING, confirm with Hubtel and fulfill if paid
    const verification = await verifyOrderPayment(order);
    const result = await applyPaymentVerification({
      order,
      verification,
      req,
      source: 'CUSTOMER_VERIFY'
    });

    if (result.paymentStatus === 'SUCCESS') {
      // Refetch the updated order to return accurate delivery status
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id }
      });

      return res.status(200).json({
        success: true,
        status: 'SUCCESS',
        message: 'Payment verified successfully from payment provider.',
        data: {
          orderId: order.id,
          paymentStatus: 'SUCCESS',
          deliveryStatus: updatedOrder.deliveryStatus
        }
      });
    }

    if (result.paymentStatus === 'FAILED') {
      return res.status(200).json({
        success: false,
        status: 'FAILED',
        message: result.message,
        data: {
          orderId: order.id,
          paymentStatus: 'FAILED'
        }
      });
    }

    // Still pending/unpaid on Hubtel
    return res.status(200).json({
      success: false,
      status: 'PENDING',
      message: 'Payment is still pending verification.',
      data: {
        orderId: order.id,
        paymentStatus: 'PENDING'
      }
    });
  } catch (error) {
    console.log('[VERIFY PAYMENT ERROR]', error.message);
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('An unexpected error occurred during payment verification.', 500));
    }
  }
};
