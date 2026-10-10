import { prisma } from '../../config/config.js';
import { initiateHubtelDirectDebit, sendUssdFulfillmentCallback } from '../../utils/payment/hubtelHelper.js';
import { verifyOrderPaymentWithRetry } from '../../utils/payment/verifyOrderPayment.js';
import { applyPaymentVerification } from './orderController.js';
import { trackUssdDialer } from '../../utils/ussd/ussdTracker.js';
import { signUssdState, readUssdState } from '../../utils/ussd/ussdState.js';
import { readPin } from '../../utils/voucher/voucherPin.js';
import { scheduleUssdFulfillmentFollowUp } from '../../utils/ussd/ussdFulfillmentFollowUp.js';
import { logActivity } from '../../utils/activityLog/activityLogger.js';
import {
  generateOrderId,
  getUnitPrice,
  phoneNumberVariants,
  MAX_VOUCHERS_PER_ORDER
} from '../../utils/order/orderHelpers.js';

const VOUCHER_TYPES = ['BECE', 'WASSCE_NOVDEC'];

const formatDate = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(date);
  const day = pad(d.getUTCDate());
  const month = pad(d.getUTCMonth() + 1);
  const year = String(d.getUTCFullYear()).substring(2);
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

const displayNameFor = (voucherType) => (voucherType === 'WASSCE_NOVDEC' ? 'WASSCE/NOVDEC' : voucherType);

const mainMenuText = (config, header = 'CivicTree Vouchers:') =>
  `${header}\n1. Buy BECE (GHS ${Number(config.becePrice).toFixed(2)})\n2. Buy WASSCE/NOVDEC (GHS ${Number(config.wassceNovdecPrice).toFixed(2)})\n3. Transactions\n4. Release Dates\n5. Support`;

/**
 * Handles interactive USSD menu navigation requests from Hubtel.
 */
export const handleUssdInteraction = async (req, res, next) => {
  /*
    #swagger.tags = ['Public - USSD']
    #swagger.summary = 'Handle Hubtel USSD Session Menu'
    #swagger.description = 'Processes incoming initiation, response, or timeout events for interactive USSD checkout.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              Type: { type: "string", example: "Initiation" },
              Message: { type: "string", example: "*713#" },
              Operator: { type: "string", example: "mtn" },
              ClientState: { type: "string", example: "" },
              Mobile: { type: "string", example: "233257581661" },
              SessionId: { type: "string", example: "session-abc-123" },
              Sequence: { type: "integer", example: 1 }
            }
          }
        }
      }
    }
  */
  try {
    const { Type, Message, Operator, ClientState, Mobile, SessionId } = req.body || {};

    if (!SessionId || typeof SessionId !== 'string' || !Mobile || typeof Mobile !== 'string') {
      return res.status(400).json({ error: 'SessionId and Mobile are required' });
    }

    const stateContext = { sessionId: SessionId, mobile: Mobile };
    const state = readUssdState(ClientState, stateContext);

    console.log(`[USSD INTERACTION] SessionId: ${SessionId}, Type: ${Type}, State: ${state ? state.split(':')[0] : 'none'}`);

    const release = (message, label) => res.status(200).json({
      SessionId,
      Type: 'release',
      Message: message,
      Label: label,
      DataType: 'display'
    });

    const prompt = (message, label, nextState, fieldType = 'text') => res.status(200).json({
      SessionId,
      Type: 'response',
      Message: message,
      Label: label,
      ClientState: signUssdState(nextState, stateContext),
      DataType: 'input',
      FieldType: fieldType
    });

    // 1. Handle session timeout
    if (Type === 'Timeout') {
      return release('Session timed out. Goodbye.', 'Timeout');
    }

    // Fetch pricing configuration
    const config = await prisma.voucherConfig.findFirst();
    if (!config) {
      return release('System is not configured. Please contact administration.', 'Error');
    }

    // 2. Handle session initiation
    if (Type === 'Initiation') {
      return prompt(mainMenuText(config), 'Welcome Menu', 'SELECT_OPTION');
    }

    if (Type !== 'Response') {
      return release('Thank you for choosing CivicTree.', 'CivicTree');
    }

    // 3. Handle user responses
    const input = (Message || '').trim();

    // A missing, forged, or expired state restarts the menu
    if (!state) {
      return prompt(mainMenuText(config), 'Welcome Menu', 'SELECT_OPTION');
    }

    // STATE: Selection of option from main menu
    if (state === 'SELECT_OPTION') {
      // Options 1, 2: Buy Vouchers (1: BECE, 2: WASSCE/NOVDEC)
      if (['1', '2'].includes(input)) {
        const voucherType = input === '1' ? 'BECE' : 'WASSCE_NOVDEC';

        // Track USSD dialer for the selected voucher type
        trackUssdDialer({
          phoneNumber: Mobile,
          voucherType,
          source: 'MAIN_USSD',
          dialedCode: req.body.ServiceCode || Message
        });

        const availableStock = await prisma.voucher.count({
          where: { type: voucherType, status: 'AVAILABLE' }
        });

        const displayName = displayNameFor(voucherType);

        if (availableStock === 0) {
          return release(`Sorry, ${displayName} vouchers are currently out of stock. Please try again later.`, 'Out of Stock');
        }

        const totalAmountToCharge = getUnitPrice(config, voucherType) * 1;

        return prompt(
          `Confirm purchase of 1 x ${displayName} checker for GHS ${totalAmountToCharge.toFixed(2)}?\n1. Yes, pay now\n2. Cancel`,
          'Confirm Payment',
          `CONFIRM:${voucherType}:1`
        );
      }

      // Option 3: Transactions List (only this caller's own orders)
      if (input === '3') {
        const orders = await prisma.order.findMany({
          where: {
            phoneNumber: { in: phoneNumberVariants(Mobile) },
            paymentStatus: 'SUCCESS'
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        });

        if (orders.length === 0) {
          return release('No transactions found for your mobile number.', 'Transactions');
        }

        let menuMessage = 'Select Transaction to see voucher:';
        orders.forEach((order, idx) => {
          menuMessage += `\n${idx + 1}) ${displayNameFor(order.voucherType)} ${formatDate(order.createdAt)}`;
        });

        const orderIdsCsv = orders.map(o => o.id).join(',');

        return prompt(menuMessage, 'Select Transaction', `TX_SELECT:${orderIdsCsv}`);
      }

      // Option 4: Exam Results Release Dates Sub-Menu
      if (input === '4') {
        return prompt(
          'Select Release Date:\n1. BECE Results Release Date\n2. WASSCE Results Release Date',
          'Release Dates Menu',
          'SELECT_RELEASE_DATE_TYPE'
        );
      }

      // Option 5: Help/Support Contact
      if (input === '5') {
        return release('Call or WhatsApp Civictree on 0556069880 for support.', 'Support');
      }

      // Invalid input
      return prompt(mainMenuText(config, 'Invalid option.'), 'Welcome Menu', 'SELECT_OPTION');
    }

    // STATE: Select release date type (1: BECE, 2: WASSCE)
    if (state === 'SELECT_RELEASE_DATE_TYPE') {
      if (input === '1' || input === '2') {
        const voucherType = input === '1' ? 'BECE' : 'WASSCE_NOVDEC';

        trackUssdDialer({
          phoneNumber: Mobile,
          voucherType,
          source: 'MAIN_USSD',
          dialedCode: req.body.ServiceCode || Message
        });

        if (voucherType === 'BECE') {
          const bDate = config.beceReleaseDate ? formatDate(config.beceReleaseDate).split(' ')[0] : 'To be announced';
          return release(`The BECE results are expected to be released on ${bDate}.`, 'BECE Release Date');
        }

        const wnDate = config.wassceNovdecReleaseDate ? formatDate(config.wassceNovdecReleaseDate).split(' ')[0] : 'To be announced';
        return release(`The WASSCE results are expected to be released on ${wnDate}.`, 'WASSCE Release Date');
      }

      return release('Invalid option selected. Session ended.', 'Error');
    }

    // STATE: Select a transaction from list
    if (state.startsWith('TX_SELECT:')) {
      const orderIds = state.substring('TX_SELECT:'.length).split(',');
      const choice = parseInt(input, 10);

      if (isNaN(choice) || choice < 1 || choice > orderIds.length) {
        return release('Invalid choice selected. Session ended.', 'Error');
      }

      // Re-check ownership: only show vouchers of a paid order placed from this number
      const order = await prisma.order.findFirst({
        where: {
          id: orderIds[choice - 1],
          phoneNumber: { in: phoneNumberVariants(Mobile) },
          paymentStatus: 'SUCCESS'
        },
        include: { vouchers: true }
      });

      if (!order || order.vouchers.length === 0) {
        return release('No vouchers found for this transaction.', 'Not Found');
      }

      let voucherMessage = `Voucher(s) for ${order.id}:\n`;
      order.vouchers.forEach((v, idx) => {
        voucherMessage += `${idx + 1}) S/N: ${v.serialNumber}\n   PIN: ${readPin(v.pin)}\n`;
      });

      return release(voucherMessage.trim(), 'Voucher Details');
    }

    // STATE: Input quantity
    if (state.startsWith('QTY:')) {
      const voucherType = state.split(':')[1];
      const qty = parseInt(input, 10);

      if (!VOUCHER_TYPES.includes(voucherType)) {
        return release('Invalid selection. Session ended.', 'Error');
      }

      if (isNaN(qty) || qty <= 0 || qty > MAX_VOUCHERS_PER_ORDER) {
        return prompt(`Invalid quantity. Please enter a number from 1 to ${MAX_VOUCHERS_PER_ORDER}:`, 'Enter Quantity', state, 'number');
      }

      const availableStock = await prisma.voucher.count({
        where: { type: voucherType, status: 'AVAILABLE' }
      });

      if (qty > availableStock) {
        return prompt(`Insufficient stock. Only ${availableStock} available. Enter quantity:`, 'Enter Quantity', state, 'number');
      }

      const totalAmountToCharge = getUnitPrice(config, voucherType) * qty;

      return prompt(
        `Confirm purchase of ${qty} x ${displayNameFor(voucherType)} checker(s) for GHS ${totalAmountToCharge.toFixed(2)}?\n1. Yes, pay now\n2. Cancel`,
        'Confirm Payment',
        `CONFIRM:${voucherType}:${qty}`
      );
    }

    // STATE: Confirmation
    if (state.startsWith('CONFIRM:')) {
      if (input !== '1') {
        return release('Voucher purchase cancelled. Thank you.', 'Cancelled');
      }

      const [, voucherType, qtyStr] = state.split(':');
      const qty = parseInt(qtyStr, 10);

      if (!VOUCHER_TYPES.includes(voucherType) || isNaN(qty) || qty <= 0 || qty > MAX_VOUCHERS_PER_ORDER) {
        return release('Invalid selection. Session ended.', 'Error');
      }

      // The price always comes from the current pricing config, never from the request
      const totalAmountToCharge = getUnitPrice(config, voucherType) * qty;
      const orderId = await generateOrderId();

      // Create pending order - store actual base amount in DB
      await prisma.order.create({
        data: {
          id: orderId,
          customerName: 'USSD Customer',
          phoneNumber: Mobile,
          voucherType,
          quantity: qty,
          amount: totalAmountToCharge,
          channel: 'USSD',
          paymentStatus: 'PENDING',
          deliveryStatus: 'NOT_SENT',
          transactionId: SessionId // Match with SessionId in callback
        }
      });

      // Trigger mobile money direct debit push prompt
      try {
        await initiateHubtelDirectDebit({
          orderId,
          amount: totalAmountToCharge,
          phoneNumber: Mobile,
          customerName: 'USSD Customer',
          channel: Operator, // Pass direct operator network from USSD
          description: `USSD Vouchers Purchase - ${qty} x ${voucherType}`
        });
      } catch (err) {
        console.error('USSD Direct Debit prompt failed to initiate:', err.message);
      }

      // Return AddToCart to let Hubtel process standard payment lifecycle
      return res.status(200).json({
        SessionId,
        Type: 'AddToCart',
        Message: `Payment prompt sent to your phone. Enter your Mobile Money PIN to authorize GHS ${totalAmountToCharge.toFixed(2)}.`,
        Item: {
          ItemName: `${qty} x ${voucherType} Voucher(s)`,
          Qty: 1,
          Price: totalAmountToCharge
        },
        Label: 'Payment Sent',
        DataType: 'display',
        FieldType: 'text'
      });
    }

    // Default release if no action matches
    return release('Thank you for choosing CivicTree.', 'CivicTree');
  } catch (error) {
    console.log('[USSD INTERACTION EXCEPTION] Error:', error.message);
    next(error);
  }
};

/**
 * Handles Hubtel's service fulfillment request for USSD orders (main and affiliate USSD).
 * The payment is confirmed with Hubtel's status API before any voucher is released;
 * the OrderInfo in the request body is never trusted on its own.
 */
export const processUssdFulfillment = async (req, res, next, logPrefix = 'USSD FULFILLMENT') => {
  try {
    const { SessionId, OrderId, OrderInfo } = req.body || {};

    console.log(`[${logPrefix}] SessionId: ${SessionId}, OrderId: ${OrderId}, reported status: ${OrderInfo?.Status}`);

    if (!SessionId || !OrderId || typeof SessionId !== 'string' || typeof OrderId !== 'string') {
      return res.status(400).json({ error: 'SessionId and OrderId are required' });
    }

    // Look up the order by transactionId (which holds SessionId until the order is fulfilled)
    const order = await prisma.order.findUnique({
      where: { transactionId: SessionId }
    });

    if (!order) {
      console.warn(`[${logPrefix}] Order not found for SessionId: ${SessionId}`);
      return res.status(404).json({ error: 'Order not found for given USSD session' });
    }

    if (order.paymentStatus !== 'PENDING') {
      console.log(`[${logPrefix}] Order ${order.id} already ${order.paymentStatus}.`);
      return res.status(200).json({ success: true });
    }

    const verification = await verifyOrderPaymentWithRetry(order);

    if (OrderInfo?.Status === 'Paid' && verification.outcome !== 'PAID') {
      logActivity({
        action: 'ORDER_PAYMENT_CALLBACK_UNCONFIRMED',
        details: { orderId: order.id, sessionId: SessionId, reportedStatus: OrderInfo?.Status, verification: verification.outcome },
        req
      });
    }

    const result = await applyPaymentVerification({
      order,
      verification,
      req,
      source: logPrefix
    });

    console.log(`[${logPrefix}] Order ${order.id}: verification ${verification.outcome}, payment status ${result.paymentStatus}`);

    if (result.paymentStatus === 'SUCCESS') {
      await sendUssdFulfillmentCallback({ sessionId: SessionId, orderId: OrderId, status: 'success' });
    } else if (result.paymentStatus === 'FAILED') {
      await sendUssdFulfillmentCallback({ sessionId: SessionId, orderId: OrderId, status: 'failed' });
    } else {
      // Not confirmed yet: keep checking and send Hubtel's callback once the payment settles
      scheduleUssdFulfillmentFollowUp({ orderId: order.id, sessionId: SessionId, hubtelOrderId: OrderId });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.log(`[${logPrefix} EXCEPTION] Error:`, error.message);
    next(error);
  }
};

/**
 * Handles payment fulfillment notification from Hubtel for USSD orders.
 */
export const handleUssdFulfillment = async (req, res, next) => {
  /*
    #swagger.tags = ['Public - USSD']
    #swagger.summary = 'Handle Hubtel USSD Service Fulfillment Callback'
    #swagger.description = 'Invoked by Hubtel upon successful payment of a USSD order. Confirms the payment with Hubtel, then triggers order fulfillment.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              SessionId: { type: "string", example: "session-abc-123" },
              OrderId: { type: "string", example: "hubtel-order-id-456" },
              OrderInfo: {
                type: "object",
                properties: {
                  CustomerMobileNumber: { type: "string", example: "233257581661" },
                  Status: { type: "string", example: "Paid" }
                }
              }
            }
          }
        }
      }
    }
  */
  return processUssdFulfillment(req, res, next, 'USSD FULFILLMENT');
};
