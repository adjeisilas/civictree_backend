import axios from 'axios';
import config from '../../config/config.js';
import { AppError } from '../error/AppError.js';

/**
 * URL Hubtel calls with the final payment status. Includes HUBTEL_CALLBACK_TOKEN when configured.
 */
const paymentCallbackUrl = () => {
  const base = `${config.apiUrl}/api/orders/webhook`;
  return config.hubtel.callbackToken ? `${base}/${encodeURIComponent(config.hubtel.callbackToken)}` : base;
};

/**
 * URL Hubtel calls with the final payout (Send Money) status.
 */
const payoutCallbackUrl = () => {
  const base = `${config.apiUrl}/api/payouts/webhook`;
  return config.hubtel.callbackToken ? `${base}/${encodeURIComponent(config.hubtel.callbackToken)}` : base;
};

/**
 * Normalizes operator strings (e.g. from USSD) to Hubtel payment channel names.
 * @param {string} operator - The operator name (e.g. MTN, Vodafone, Telecel, AirtelTigo)
 * @returns {string} The normalized channel name (mtn-gh, vodafone-gh, tigo-gh)
 */
export const normalizeMomoChannel = (operator) => {
  if (!operator) return 'mtn-gh';
  const op = operator.toLowerCase().trim();
  if (op.includes('mtn')) return 'mtn-gh';
  if (op.includes('vodafone') || op.includes('telecel') || op.includes('telecel-gh') || op.includes('vodafone-gh')) return 'vodafone-gh';
  if (op.includes('tigo') || op.includes('airteltigo') || op.includes('airteltigo-gh') || op.includes('tigo-gh')) return 'tigo-gh';
  return op;
};

/**
 * Calculates total payable amount including the 1.8% Hubtel payment gateway fee.
 * Example: Base GHS 30.00 => Payable GHS 30.54 (30 * 1.018)
 * @param {number} baseAmount 
 * @returns {number} Payable amount rounded to 2 decimal places
 */
export const calculatePayableAmountWithFee = (baseAmount) => {
  const base = parseFloat(baseAmount);
  if (isNaN(base) || base <= 0) return 0;
  return parseFloat(base.toFixed(2));
};

/**
 * Initiates a payment checkout session with Hubtel (Online Checkout - Redirect).
 * 
 * @param {Object} params
 * @param {string} params.orderId - Unique order identifier (e.g. #CT-1001)
 * @param {number} params.amount - Total payment amount in GHS (Decimal)
 * @param {string} params.phoneNumber - Customer's phone number
 * @param {string} params.customerName - Customer's name (optional)
 * @param {string} params.voucherType - Voucher category (WASSCE, BECE, NOVDEC)
 * @param {number} params.quantity - Number of vouchers purchased
 * @returns {Promise<Object>} Object containing the checkout URL and transaction reference (checkoutId)
 */
export const initiateHubtelCheckout = async ({
  orderId,
  amount,
  phoneNumber,
  customerName,
  voucherType,
  quantity
}) => {
  const { apiId, apiKey, merchantAccountNumber } = config.hubtel;
  
  if (!apiId || !apiKey || !merchantAccountNumber) {
    throw new Error('Hubtel credentials are not configured. Please set HUBTEL_PAYMENT_API_ID, HUBTEL_PAYMENT_API_KEY, and HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER in your environment.');
  }

  // Construct Basic Auth header (API ID = username, API Key = password)
  const authHeader = `Basic ${Buffer.from(`${apiId}:${apiKey}`).toString('base64')}`;

  const callbackUrl = paymentCallbackUrl();
  const returnUrl = config.hubtel.returnUrl; 
  const cancellationUrl = config.hubtel.cancellationUrl;

  // Calculate total payable amount including 1.8% Hubtel payment gateway fee
  const payableAmount = calculatePayableAmountWithFee(amount);

  const payload = {
    totalAmount: payableAmount,
    description: `Payment for ${quantity} x ${voucherType} results checker voucher(s)`,
    callbackUrl,
    returnUrl,
    cancellationUrl,
    merchantAccountNumber,
    clientReference: orderId,
    payeeName: customerName || 'Valued Customer',
    payeeMobileNumber: phoneNumber
  };

  console.log(`[HUBTEL CHECKOUT INITIATE] Order ${orderId}: amount ${payableAmount}`);

  try {
    // Call Hubtel Online Checkout API (payproxyapi.hubtel.com)
    const response = await axios.post(
      'https://payproxyapi.hubtel.com/items/initiate',
      payload,
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 100000
      }
    );

    const data = response.data;
    console.log(`[HUBTEL CHECKOUT INITIATE] Order ${orderId}: responseCode ${data.responseCode}, status ${data.status}`);
    const isSuccess = data.responseCode === '0000' || data.status === 'Success';

    if (!isSuccess) {
      throw new Error(data.message || 'Hubtel checkout initiation failed');
    }

    const responseData = data.data || data;

    return {
      checkoutUrl: responseData.checkoutUrl || responseData.checkoutDirectUrl,
      transactionId: responseData.checkoutId || null
    };
  } catch (error) {
    console.log(`[HUBTEL CHECKOUT INITIATE ERROR] Failed for order ${orderId}:`, JSON.stringify(error.response?.data || error.message, null, 2));
    console.error('Hubtel Checkout Initiation Error:', error.response?.data || error.message);
    throw new Error(
      error.response?.data?.message || 
      error.message || 
      'Failed to initiate transaction with Hubtel payment gateway'
    );
  }
};

/**
 * Initiates a Direct Mobile Money debit prompt (Direct Receive Money API) for USSD flow.
 * Sends a push request directly to the customer's wallet requiring PIN verification.
 * 
 * @param {Object} params
 * @param {string} params.orderId - Unique order identifier
 * @param {number} params.amount - Amount to debit
 * @param {string} params.phoneNumber - Subscriber mobile money number
 * @param {string} params.customerName - Name of the customer (optional)
 * @param {string} params.channel - Momo provider channel (mtn-gh, vodafone-gh, tigo-gh) (optional)
 * @param {string} params.description - Transaction description (optional)
 * @returns {Promise<Object>} Object containing the status and transaction details
 */
export const initiateHubtelDirectDebit = async ({
  orderId,
  amount,
  phoneNumber,
  customerName,
  channel,
  description
}) => {
  const { apiId, apiKey, merchantAccountNumber } = config.hubtel;
  
  if (!apiId || !apiKey || !merchantAccountNumber) {
    throw new Error('Hubtel credentials are not configured. Please set HUBTEL_PAYMENT_API_ID, HUBTEL_PAYMENT_API_KEY, and HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER in your environment.');
  }

  const authHeader = `Basic ${Buffer.from(`${apiId}:${apiKey}`).toString('base64')}`;
  
  // Normalize phone number to 233XXXXXXXXX format
  let formattedPhone = phoneNumber.trim();
  if (formattedPhone.startsWith('+')) {
    formattedPhone = formattedPhone.substring(1);
  } else if (formattedPhone.startsWith('0') && formattedPhone.length === 10) {
    formattedPhone = '233' + formattedPhone.substring(1);
  }

  const resolvedChannel = normalizeMomoChannel(channel);
  const callbackUrl = paymentCallbackUrl();

  // Calculate total payable amount including 1.8% Hubtel payment gateway fee
  const payableAmount = calculatePayableAmountWithFee(amount);

  const payload = {
    CustomerName: customerName || 'Valued Customer',
    CustomerMsisdn: formattedPhone,
    CustomerEmail: '',
    Channel: resolvedChannel,
    Amount: payableAmount,
    PrimaryCallbackUrl: callbackUrl,
    Description: description || 'USSD Voucher Purchase Direct Debit',
    ClientReference: orderId
  };

  console.log(`[HUBTEL DIRECT DEBIT INITIATE] Order ${orderId}: amount ${payableAmount}, channel ${resolvedChannel}`);

  try {
    // Call Hubtel Direct Receive Money API
    const response = await axios.post(
      `https://rmp.hubtel.com/merchantaccount/merchants/${merchantAccountNumber}/receive/mobilemoney`,
      payload,
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 100000
      }
    );

    const data = response.data;
    console.log(`[HUBTEL DIRECT DEBIT INITIATE] Order ${orderId}: ResponseCode ${data.ResponseCode}`);
    // ResponseCode 0001 means request accepted and callback is expected for final state
    const isSuccess = data.ResponseCode === '0001' || data.ResponseCode === '0000';

    if (!isSuccess) {
      throw new Error(data.Message || 'Direct Momo debit prompt failed to initiate');
    }

    return {
      success: true,
      message: data.Message,
      transactionId: data.Data?.TransactionId || null,
      clientReference: data.Data?.ClientReference || orderId
    };
  } catch (error) {
    console.log(`[HUBTEL DIRECT DEBIT ERROR] Failed for order ${orderId}:`, typeof error.response?.data === 'string' ? error.response.data : JSON.stringify(error.response?.data || error.message, null, 2));
    console.error('Hubtel Direct Debit Error:', error.response?.data || error.message);
    throw new Error(
      error.response?.data?.Message || 
      error.message || 
      'Failed to initiate direct payment prompt with Hubtel'
    );
  }
};

/**
 * Checks the status of a transaction with Hubtel (Transaction Status Check API).
 * 
 * @param {string} clientReference - The client reference of the transaction (order ID)
 * @returns {Promise<Object>} Status information (Paid, Unpaid, Refunded, or failed)
 */
export const checkHubtelTransactionStatus = async (clientReference) => {
  const { apiId, apiKey, merchantAccountNumber } = config.hubtel;
  
  if (!apiId || !apiKey || !merchantAccountNumber) {
    throw new Error('Hubtel credentials are not configured. Please set HUBTEL_PAYMENT_API_ID, HUBTEL_PAYMENT_API_KEY, and HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER in your environment.');
  }

  const authHeader = `Basic ${Buffer.from(`${apiId}:${apiKey}`).toString('base64')}`;

  try {
    console.log(`[HUBTEL STATUS CHECK] Querying status for clientReference: ${clientReference}`);
    // Call Hubtel Status Check API (api-txnstatus.hubtel.com)
    const response = await axios.get(
      `https://api-txnstatus.hubtel.com/transactions/${merchantAccountNumber}/status`,
      {
        params: { clientReference },
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        },
        timeout: 20000
      }
    );

    const data = response.data;
    console.log(`[HUBTEL STATUS CHECK] Reference ${clientReference}: responseCode ${data.responseCode}, status ${data.data?.status}, amount ${data.data?.amount}`);

    if (data.responseCode !== '0000') {
      throw new Error(data.message || 'Failed to check transaction status with Hubtel');
    }

    return {
      success: true,
      message: data.message,
      status: data.data?.status, // Paid, Unpaid, Refunded
      transactionId: data.data?.transactionId,
      externalTransactionId: data.data?.externalTransactionId,
      amount: data.data?.amount,
      paymentMethod: data.data?.paymentMethod
    };
  } catch (error) {
    console.log(`[HUBTEL STATUS CHECK ERROR] Failed for reference ${clientReference}:`, typeof error.response?.data === 'string' ? error.response.data : JSON.stringify(error.response?.data || error.message, null, 2));
    console.error(`Hubtel Status Check Error for reference ${clientReference}:`, error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message || error.response?.data
    };
  }
};

/**
 * Sends a Service Fulfillment Callback to Hubtel to confirm that vouchers were successfully delivered.
 * Hubtel requires this to be called within 1 hour of receiving service fulfillment request.
 * 
 * @param {Object} params
 * @param {string} params.sessionId - The USSD Session ID
 * @param {string} params.orderId - The Order ID sent by Hubtel (from OrderInfo)
 * @param {string} params.status - The fulfillment status ('success' or 'failed')
 * @returns {Promise<boolean>} Whether the callback succeeded
 */
export const sendUssdFulfillmentCallback = async ({ sessionId, orderId, status = 'success' }) => {
  const payload = {
    SessionId: sessionId,
    OrderId: orderId,
    ServiceStatus: status,
    MetaData: null
  };
  console.log(`[USSD FULFILLMENT CALLBACK] Sending ${status} callback for session ${sessionId}, order ${orderId}`);
  try {
    const response = await axios.post(
      'https://gs-callback.hubtel.com:9055/callback',
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log(`[USSD FULFILLMENT CALLBACK] Received response status for session ${sessionId}: ${response.status}`);
    return response.status === 200 || response.status === 201;
  } catch (error) {
    console.log(`[USSD FULFILLMENT CALLBACK ERROR] Failed for session ${sessionId}:`, typeof error.response?.data === 'string' ? error.response.data : JSON.stringify(error.response?.data || error.message, null, 2));
    console.error(`Failed to send USSD fulfillment callback for session ${sessionId}:`, error.response?.data || error.message);
    return false;
  }
};

/**
 * Disburses / sends payout money to a Mobile Money number or Bank Account via Hubtel Direct Send Money API.
 * 
 * @param {Object} params
 * @param {string} params.recipientName - Full name of recipient
 * @param {string} params.recipientNumber - Recipient phone number (for MoMo) or account number (for Bank)
 * @param {number} params.amount - Amount in GHS
 * @param {string} params.payoutMethod - 'MOBILE_MONEY' or 'BANK_ACCOUNT'
 * @param {string} params.channel - Channel / Network e.g. mtn-gh, vodafone-gh, tigo-gh or Bank Name
 * @param {string} params.clientReference - Unique reference (e.g. withdrawal request ID)
 * @param {string} [params.description] - Description text
 * @returns {Promise<Object>}
 */
/**
 * Resolves a Bank Name string to its official GhIPSS 6-digit Bank Code.
 * @param {string} bankName 
 * @returns {string} The 6-digit Bank Code (e.g. 300304 for GCB)
 */
export const resolveBankCode = (bankName) => {
  if (!bankName) return '300304';
  const name = bankName.toLowerCase().trim();
  if (name.includes('gcb')) return '300304';
  if (name.includes('ecobank')) return '300312';
  if (name.includes('fidelity')) return '300323';
  if (name.includes('stanbic')) return '300318';
  if (name.includes('absa')) return '300303';
  if (name.includes('standard chartered')) return '300302';
  if (name.includes('cal')) return '300313';
  if (name.includes('zenith')) return '300311';
  if (name.includes('access')) return '300329';
  if (name.includes('gt') || name.includes('guaranty')) return '300322';
  if (name.includes('uba') || name.includes('united bank')) return '300325';
  if (name.includes('cbg') || name.includes('consolidated')) return '300331';
  if (name.includes('adb') || name.includes('agricultural')) return '300307';
  if (name.includes('nib') || name.includes('national investment')) return '300305';
  if (name.includes('umb') || name.includes('universal merchant')) return '300309';
  if (name.includes('republic')) return '300310';
  if (name.includes('first atlantic')) return '300316';
  if (name.includes('prudential')) return '300317';
  if (name.includes('bank of africa')) return '300320';
  if (name.includes('first national')) return '300334';
  if (name.includes('apex') || name.includes('arb')) return '300306';
  if (name.includes('first bank of nigeria') || name.includes('fbn')) return '300319';
  if (name.includes('sahel')) return '300324';
  if (name.includes('ghl')) return '300362';
  if (/^\d{6}$/.test(name)) return name;
  return '300304';
};

/**
 * Disburses / sends payout money to a Mobile Money number or Bank Account via Hubtel Direct Send Money API.
 * 
 * @param {Object} params
 * @param {string} params.recipientName - Full name of recipient
 * @param {string} params.recipientNumber - Recipient phone number (for MoMo) or account number (for Bank)
 * @param {number} params.amount - Amount in GHS
 * @param {string} params.payoutMethod - 'MOBILE_MONEY' or 'BANK_ACCOUNT'
 * @param {string} params.channel - Channel / Network e.g. mtn-gh, vodafone-gh, tigo-gh or Bank Name
 * @param {string} params.clientReference - Unique reference (e.g. withdrawal request ID)
 * @param {string} [params.description] - Description text
 * @returns {Promise<Object>}
 */
export const sendHubtelPayout = async ({
  recipientName,
  recipientNumber,
  amount,
  payoutMethod,
  channel,
  clientReference,
  description
}) => {
  const { apiId, apiKey, merchantAccountNumber, disbursementAccountNumber } = config.hubtel;

  const accountNo = (disbursementAccountNumber || merchantAccountNumber || '').trim();

  if (!apiId || !apiKey || !accountNo) {
    throw new Error('Hubtel credentials are not configured. Please set HUBTEL_PAYMENT_API_ID, HUBTEL_PAYMENT_API_KEY, and HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER in your environment.');
  }

  const authHeader = `Basic ${Buffer.from(`${apiId}:${apiKey}`).toString('base64')}`;

  let formattedPhone = (recipientNumber || '').trim();
  if (formattedPhone.startsWith('+')) {
    formattedPhone = formattedPhone.substring(1);
  } else if (formattedPhone.startsWith('0') && formattedPhone.length === 10) {
    formattedPhone = '233' + formattedPhone.substring(1);
  }

  let endpointUrl;
  let payload;

  if (payoutMethod === 'MOBILE_MONEY') {
    const resolvedChannel = normalizeMomoChannel(channel);
    endpointUrl = `https://smp.hubtel.com/api/merchants/${accountNo}/send/mobilemoney`;
    payload = {
      RecipientName: recipientName || 'Affiliate Partner',
      RecipientMsisdn: formattedPhone,
      CustomerEmail: '',
      Channel: resolvedChannel,
      Amount: parseFloat(parseFloat(amount).toFixed(2)),
      PrimaryCallbackURL: payoutCallbackUrl(),
      Description: description || `Affiliate Payout - Ref: ${clientReference}`,
      ClientReference: clientReference
    };
  } else {
    const bankCode = resolveBankCode(channel);
    endpointUrl = `https://smp.hubtel.com/api/merchants/${accountNo}/send/bank/gh/${bankCode}`;
    payload = {
      Amount: parseFloat(parseFloat(amount).toFixed(2)),
      BankAccountNumber: recipientNumber,
      BankAccountName: recipientName || 'Affiliate Partner',
      BankName: channel || 'Bank',
      BankBranch: '',
      BankBranchCode: '',
      ClientReference: clientReference,
      PrimaryCallbackUrl: payoutCallbackUrl(),
      Description: description || `Affiliate Bank Payout - Ref: ${clientReference}`,
      RecipientPhoneNumber: formattedPhone
    };
  }

  console.log(`[HUBTEL PAYOUT INITIATE] Ref ${clientReference}: ${payoutMethod}, amount ${payload.Amount}`);

  try {
    const response = await axios.post(
      endpointUrl,
      payload,
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 100000
      }
    );

    const data = response.data;
    console.log(`[HUBTEL PAYOUT INITIATE] Ref ${clientReference}: ResponseCode ${data.ResponseCode}, Status ${data.Status}`);

    const isSuccess = data.ResponseCode === '0000' || data.ResponseCode === '0001' || data.Status === 'Success';

    if (!isSuccess) {
      throw new Error(data.Message || 'Hubtel payout transfer failed to initiate');
    }

    return {
      success: true,
      // 0001 means Hubtel accepted the transfer but it is not final yet: the outcome
      // arrives on the payout callback (or from the status check).
      pending: data.ResponseCode === '0001',
      responseCode: data.ResponseCode,
      message: data.Message || 'Payout initiated successfully via Hubtel',
      transactionId: data.Data?.TransactionId || null,
      clientReference: data.Data?.ClientReference || clientReference
    };
  } catch (error) {
    const errorData = error.response?.data;
    console.log(`[HUBTEL PAYOUT ERROR] Failed for ref ${clientReference}:`, typeof errorData === 'object' ? JSON.stringify(errorData, null, 2) : errorData || error.message);
    console.error('Hubtel Payout Error:', errorData || error.message);

    let userMsg = errorData?.Message || errorData?.message || error.message;

    if (error.response?.status === 403) {
      userMsg = `Hubtel API 403 Forbidden: Server IP address is not whitelisted on Hubtel portal, or payout scope permissions ('mobilemoney-send-direct') are missing on your Hubtel API Key.`;
    }

    throw new AppError(userMsg, error.response?.status || 500);
  }
};

/**
 * Queries Hubtel's Send Money Transaction Status Check API for a payout.
 * Endpoint: GET https://smrsc.hubtel.com/api/merchants/{Disbursement_Account_Number}/transactions/status?clientReference={clientReference}
 * 
 * @param {string} clientReference - The client reference passed during payout initiation
 * @returns {Promise<Object>}
 */
export const checkHubtelPayoutStatus = async (clientReference) => {
  const { apiId, apiKey, merchantAccountNumber, disbursementAccountNumber } = config.hubtel;
  const accountNo = (disbursementAccountNumber || merchantAccountNumber || '').trim();

  if (!apiId || !apiKey || !accountNo) {
    throw new Error('Hubtel credentials are not configured.');
  }

  const authHeader = `Basic ${Buffer.from(`${apiId}:${apiKey}`).toString('base64')}`;
  const url = `https://smrsc.hubtel.com/api/merchants/${accountNo}/transactions/status?clientReference=${encodeURIComponent(clientReference)}`;

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    const data = response.data;
    console.log(`[HUBTEL PAYOUT STATUS CHECK] Ref ${clientReference}: ResponseCode ${data.ResponseCode}, status ${data.Data?.transactionStatus || data.Data?.Status}`);

    const status = data.Data?.transactionStatus || data.Data?.Status || 'unknown';

    return {
      success: true,
      status,
      transactionId: data.Data?.TransactionId || null,
      networkTransactionId: data.Data?.networkTransactionId || null,
      amount: data.Data?.Amount || 0,
      raw: data
    };
  } catch (error) {
    console.error(`[HUBTEL PAYOUT STATUS CHECK ERROR] for ${clientReference}:`, error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.Message || error.message || 'Failed to check payout status'
    };
  }
};


