import { prisma } from '../../config/config.js';
import { initiateHubtelDirectDebit } from '../../utils/payment/hubtelHelper.js';
import { processUssdFulfillment } from './ussdController.js';
import { trackUssdDialer } from '../../utils/ussd/ussdTracker.js';
import { signUssdState, readUssdState } from '../../utils/ussd/ussdState.js';
import { readPin } from '../../utils/voucher/voucherPin.js';
import {
  generateOrderId,
  getUnitPrice,
  phoneNumberVariants
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

/**
 * Handles interactive USSD menu navigation requests for Affiliate channels.
 */
export const handleAffiliateUssdInteraction = async (req, res, next) => {
  // #swagger.tags = ['Public - Affiliate USSD']
  // #swagger.summary = 'Handle Affiliate USSD Session Menu'
  // #swagger.description = 'Processes incoming interactive USSD checkout requests originating from an assigned Affiliate USSD extension code.'
  try {
    const { Type, Message, Operator, ClientState, Mobile, SessionId, ServiceCode } = req.body || {};

    if (!SessionId || typeof SessionId !== 'string' || !Mobile || typeof Mobile !== 'string') {
      return res.status(400).json({ error: 'SessionId and Mobile are required' });
    }

    const stateContext = { sessionId: SessionId, mobile: Mobile };

    // Signed state looks like 'AFF:<affiliateId>|<step>' or '<step>'
    const signedState = readUssdState(ClientState, stateContext);
    let affiliateIdFromState = null;
    let currentActionState = signedState;
    if (signedState && signedState.startsWith('AFF:')) {
      const separatorIndex = signedState.indexOf('|');
      affiliateIdFromState = signedState.substring('AFF:'.length, separatorIndex);
      currentActionState = signedState.substring(separatorIndex + 1);
    }

    console.log(`[AFFILIATE USSD INTERACTION] SessionId: ${SessionId}, Type: ${Type}, State: ${currentActionState ? currentActionState.split(':')[0] : 'none'}`);

    const release = (message, label) => res.status(200).json({
      SessionId,
      Type: 'release',
      Message: message,
      Label: label,
      DataType: 'display'
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

    // 2. Dynamic Affiliate Lookup
    let affiliate = null;

    if (affiliateIdFromState) {
      affiliate = await prisma.affiliateProfile.findUnique({
        where: { id: affiliateIdFromState }
      });
    } else if (!signedState) {
      // Find affiliate dynamically matching dialed Message or ServiceCode (e.g. *713*001# or *456*001#)
      const dialedString = (Type === 'Initiation' ? (Message || ServiceCode) : ServiceCode) || '';
      if (typeof dialedString === 'string' && dialedString.trim()) {
        affiliate = await prisma.affiliateProfile.findFirst({
          where: {
            ussdCode: {
              equals: dialedString.trim()
            }
          }
        });
      }
    }

    // If affiliate channel found, verify active & approved status
    if (affiliate && affiliate.status !== 'APPROVED') {
      return release('This affiliate channel is currently inactive. Thank you.', 'Channel Inactive');
    }

    const affStatePrefix = affiliate ? `AFF:${affiliate.id}|` : '';
    const welcomeHeader = affiliate ? `${affiliate.businessName || 'CivicTree Partner'} Vouchers:` : 'CivicTree Vouchers:';
    const mainMenuText = (header = welcomeHeader) =>
      `${header}\n1. Buy BECE (GHS ${Number(config.becePrice).toFixed(2)})\n2. Buy WASSCE/NOVDEC (GHS ${Number(config.wassceNovdecPrice).toFixed(2)})\n3. Transactions\n4. Release Dates\n5. Support`;

    const prompt = (message, label, nextStep, fieldType = 'text') => res.status(200).json({
      SessionId,
      Type: 'response',
      Message: message,
      Label: label,
      ClientState: signUssdState(`${affStatePrefix}${nextStep}`, stateContext),
      DataType: 'input',
      FieldType: fieldType
    });

    // 3. Handle session initiation
    if (Type === 'Initiation') {
      return prompt(mainMenuText(), 'Welcome Menu', 'SELECT_OPTION');
    }

    if (Type !== 'Response') {
      return release('Thank you for choosing CivicTree.', 'CivicTree');
    }

    // 4. Handle user responses
    const input = (Message || '').trim();

    // A missing, forged, or expired state restarts the menu
    if (!currentActionState) {
      return prompt(mainMenuText(), 'Welcome Menu', 'SELECT_OPTION');
    }

    // STATE: Selection of option from main menu
    if (currentActionState === 'SELECT_OPTION') {
      // Options 1, 2: Buy Vouchers (1: BECE, 2: WASSCE/NOVDEC)
      if (['1', '2'].includes(input)) {
        const voucherType = input === '1' ? 'BECE' : 'WASSCE_NOVDEC';

        // Track affiliate USSD dialer for the selected voucher type
        trackUssdDialer({
          phoneNumber: Mobile,
          voucherType,
          source: 'AFFILIATE_USSD',
          dialedCode: Message || ServiceCode,
          affiliateId: affiliate ? affiliate.id : null
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

      // Option 5: Support Contact
      if (input === '5') {
        return release('Call or WhatsApp Civictree on 0556069880 for support.', 'Support');
      }

      // Invalid input
      return prompt(mainMenuText('Invalid option.'), 'Welcome Menu', 'SELECT_OPTION');
    }

    // STATE: Select release date type for affiliate session (1: BECE, 2: WASSCE)
    if (currentActionState === 'SELECT_RELEASE_DATE_TYPE') {
      if (input === '1' || input === '2') {
        const voucherType = input === '1' ? 'BECE' : 'WASSCE_NOVDEC';

        trackUssdDialer({
          phoneNumber: Mobile,
          voucherType,
          source: 'AFFILIATE_USSD',
          dialedCode: Message || ServiceCode,
          affiliateId: affiliate ? affiliate.id : null
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
    if (currentActionState.startsWith('TX_SELECT:')) {
      const orderIds = currentActionState.substring('TX_SELECT:'.length).split(',');
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

    // STATE: Confirmation
    if (currentActionState.startsWith('CONFIRM:')) {
      if (input !== '1') {
        return release('Voucher purchase cancelled. Thank you.', 'Cancelled');
      }

      const [, voucherType, qtyStr] = currentActionState.split(':');
      const qty = parseInt(qtyStr, 10);

      // The affiliate menu only sells one voucher per order
      if (!VOUCHER_TYPES.includes(voucherType) || qty !== 1) {
        return release('Invalid selection. Session ended.', 'Error');
      }

      // The price always comes from the current pricing config, never from the request
      const totalAmountToCharge = getUnitPrice(config, voucherType) * qty;
      const orderId = await generateOrderId();

      // Create pending order with affiliate attribution - store actual base amount in DB
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
          transactionId: SessionId,
          affiliateId: affiliate ? affiliate.id : null,
          affiliateCode: affiliate ? affiliate.ussdCode : null
        }
      });

      // Trigger Mobile Money Push
      try {
        await initiateHubtelDirectDebit({
          orderId,
          amount: totalAmountToCharge,
          phoneNumber: Mobile,
          customerName: 'USSD Customer',
          channel: Operator,
          description: `USSD Voucher Purchase - ${qty} x ${voucherType}`
        });
      } catch (err) {
        console.error('Affiliate USSD Direct Debit initiation failed:', err.message);
      }

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

    // Default release
    return release('Thank you for choosing CivicTree.', 'CivicTree');
  } catch (error) {
    console.error('[AFFILIATE USSD INTERACTION EXCEPTION] Error:', error.message);
    next(error);
  }
};

/**
 * Handles payment fulfillment notification from Hubtel for Affiliate USSD orders.
 * Affiliate commission is credited inside order fulfillment, once per order.
 */
export const handleAffiliateUssdFulfillment = async (req, res, next) => {
  // #swagger.tags = ['Public - Affiliate USSD']
  // #swagger.summary = 'Handle Affiliate USSD Fulfillment Callback'
  // #swagger.description = 'Invoked by Hubtel upon successful payment of an affiliate USSD order. Confirms the payment with Hubtel, allocates vouchers, dispatches SMS, and credits affiliate commission.'
  return processUssdFulfillment(req, res, next, 'AFFILIATE USSD FULFILLMENT');
};
