import { prisma } from '../../config/config.js';

/**
 * Asynchronously tracks USSD dialer phone numbers without delaying or blocking the USSD response.
 * Safely handles duplicates by checking uniqueness; if phoneNumber already exists (@unique), it completes silently.
 * 
 * @param {Object} params
 * @param {string} params.phoneNumber - Subscriber mobile number from USSD request (Mobile)
 * @param {string} [params.source] - USSD source ('MAIN_USSD' or 'AFFILIATE_USSD')
 * @param {string} [params.dialedCode] - The USSD string dialed (e.g. *713# or *713*001#)
 * @param {string} [params.affiliateId] - Optional affiliate profile ID
 */
export const trackUssdDialer = ({ phoneNumber, voucherType, source = 'MAIN_USSD', dialedCode, affiliateId }) => {
  if (!phoneNumber || !voucherType) return;

  // Execute asynchronously via setImmediate without awaiting to ensure zero delay on USSD response
  setImmediate(async () => {
    try {
      let formattedPhone = phoneNumber.trim();

      // Normalize phone number if needed (e.g. 233XXXXXXXXX or 0XXXXXXXXX)
      if (formattedPhone.startsWith('+')) {
        formattedPhone = formattedPhone.substring(1);
      }

      const existing = await prisma.ussdDialer.findFirst({
        where: {
          phoneNumber: formattedPhone,
          voucherType
        }
      });

      if (!existing) {
        await prisma.ussdDialer.create({
          data: {
            phoneNumber: formattedPhone,
            voucherType,
            source,
            dialedCode: dialedCode ? dialedCode.trim() : null,
            affiliateId: affiliateId || null
          }
        });
        console.log(`[USSD DIAL TRACKER] Tracked new unique dialer for ${voucherType}: ${formattedPhone} (${source})`);
      }
    } catch (error) {
      // Fail gracefully / silently so USSD interaction flow is never interrupted
      console.error('[USSD DIAL TRACKER EXCEPTION] Silent fail:', error.message);
    }
  });
};
