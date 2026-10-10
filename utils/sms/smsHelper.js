import axios from 'axios';
import config from '../../config/config.js';
import { logger } from '../logger.js';

const { clientId, clientSecret, senderId: SMS_SENDER_ID } = config.sms;

/**
 * Sends SMS via Hubtel Programmable SMS API. Falls back to console log if credentials are missing.
 * @param {object} params
 * @param {string} params.to - Recipient phone number (e.g. +233xxxxxxxxx or 02xxxxxxxx)
 * @param {string} params.message - Message body text
 */
export const sendSMS = async ({ to, message }) => {
  try {
    if (!clientId || !clientSecret) {
      logger.warn('SMS not sent: no Hubtel SMS credentials configured', { to, messageLength: message.length });
      return { success: true, mock: true };
    }

    // Normalize recipient phone number for Hubtel
    // Hubtel expects phone numbers in international format (e.g., 23324XXXXXXX)
    let formattedTo = to.trim();
    if (formattedTo.startsWith('+')) {
      formattedTo = formattedTo.substring(1);
    } else if (formattedTo.startsWith('0') && formattedTo.length === 10) {
      formattedTo = '233' + formattedTo.substring(1);
    }

    const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

    // Standard API request to Hubtel Programmable SMS
    const response = await axios.post(
      'https://sms.hubtel.com/v1/messages/send',
      {
        From: SMS_SENDER_ID,
        To: formattedTo,
        Content: message,
        Type: 'text'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        }
      }
    );

    logger.info('SMS sent', { to, status: response.data?.status });
    return { success: true, data: response.data };
  } catch (error) {
    logger.error('SMS failed', { to, error: error.response?.data || error.message });
    // Do not throw so that it doesn't crash the cron job
    return { success: false, error: error.message };
  }
};

/**
 * Sends Batch SMS via Hubtel Batch Simple SMS API. Falls back to console log if credentials are missing.
 * @param {object} params
 * @param {string[]} params.recipients - Array of recipient phone numbers
 * @param {string} params.message - Message body text
 */
export const sendBatchSMS = async ({ recipients, message }) => {
  try {
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return { success: true, count: 0 };
    }

    if (!clientId || !clientSecret) {
      logger.warn('Batch SMS not sent: no Hubtel SMS credentials configured', { recipients: recipients.length, messageLength: message.length });
      return { success: true, mock: true, count: recipients.length };
    }

    // Normalize recipient phone numbers for Hubtel
    const formattedRecipients = recipients.map(to => {
      let formatted = to.trim();
      if (formatted.startsWith('+')) {
        formatted = formatted.substring(1);
      } else if (formatted.startsWith('0') && formatted.length === 10) {
        formatted = '233' + formatted.substring(1);
      }
      return formatted;
    });

    const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

    const response = await axios.post(
      'https://sms.hubtel.com/v1/messages/batch/simple/send',
      {
        From: SMS_SENDER_ID,
        Recipients: formattedRecipients,
        Content: message
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        }
      }
    );

    logger.info('Batch SMS sent', { recipients: recipients.length, status: response.data?.status });
    return { success: true, data: response.data, count: recipients.length };
  } catch (error) {
    logger.error('Batch SMS failed', { recipients: recipients.length, error: error.response?.data || error.message });
    return { success: false, error: error.message };
  }
};
