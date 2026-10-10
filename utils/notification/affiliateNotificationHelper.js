import { sendSMS, sendBatchSMS } from '../sms/smsHelper.js';
import { sendEmail } from '../email/email.js';
import { prisma } from '../../config/config.js';
import { notifyAllAdmins } from './pushHelper.js';

/**
 * Generates email HTML and SMS message for affiliate status changes and sends them.
 * 
 * @param {Object} params
 * @param {Object} params.user - User object (fullName, email, phoneNumber)
 * @param {Object} params.profile - Affiliate profile object (affiliateCode, ussdCode, payoutMethod)
 * @param {string} params.status - Updated status ('APPROVED', 'REJECTED', 'SUSPENDED', 'DEACTIVATED')
 * @param {string} [params.rejectionReason] - Reason if status is REJECTED
 */
export const notifyAffiliateStatusChange = async ({ user, profile, status, rejectionReason }) => {
  if (!user || !profile || !status) return;

  const fullName = user.fullName || 'Affiliate Partner';
  const email = user.email;
  const phoneNumber = user.phoneNumber;
  const affiliateCode = profile.affiliateCode;
  const ussdCode = profile.ussdCode || 'Pending Assignment';

  // Build Short SMS Body (Strictly <= 245 characters)
  let smsContent = '';
  let emailSubject = '';
  let badgeColor = '#2e7d32';
  let badgeText = status;
  let mainHeadline = '';
  let subMessage = '';
  let actionBoxHtml = '';

  switch (status) {
    case 'APPROVED':
      smsContent = `Hello ${fullName}, your CivicTree Affiliate account is APPROVED! Assigned USSD: ${ussdCode}. Log in to your dashboard to track sales. Thank you!`;
      emailSubject = `🎉 Application Approved! Welcome to CivicTree Affiliate Program (${affiliateCode})`;
      badgeColor = '#2e7d32';
      badgeText = 'APPROVED & ACTIVE';
      mainHeadline = 'Congratulations! Your Application has been Approved';
      subMessage = `We are excited to welcome you to the CivicTree Affiliate Program. Your unique USSD sales channel is now active and ready for customers.`;
      actionBoxHtml = `
        <div style="background-color: #f1f8e9; border-left: 4px solid #2e7d32; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <h4 style="margin: 0 0 8px 0; color: #1b5e20;">Your Dedicated USSD Extension</h4>
          <p style="margin: 0; font-size: 22px; font-weight: bold; color: #2e7d32; letter-spacing: 1px;">${ussdCode}</p>
          <p style="margin: 8px 0 0 0; font-size: 13px; color: #558b2f;">Share this USSD code with your customers. Every voucher purchased via this code earns you automatic commission!</p>
        </div>
      `;
      break;

    case 'REJECTED':
      smsContent = `Hello ${fullName}, your CivicTree Affiliate application was not approved. Reason: ${rejectionReason || 'Incomplete verification'}. Support: 0556069880.`;
      emailSubject = `Update regarding your CivicTree Affiliate Application (${affiliateCode})`;
      badgeColor = '#c62828';
      badgeText = 'APPLICATION NOT APPROVED';
      mainHeadline = 'Affiliate Application Status Update';
      subMessage = `Thank you for your interest in the CivicTree Affiliate Program. After reviewing your application details, we regret to inform you that it was not approved at this time.`;
      actionBoxHtml = `
        <div style="background-color: #ffebee; border-left: 4px solid #c62828; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <h4 style="margin: 0 0 8px 0; color: #b71c1c;">Reason for Decision</h4>
          <p style="margin: 0; font-size: 14px; color: #c62828;">${rejectionReason || 'Incomplete account details or verification guidelines not met.'}</p>
        </div>
      `;
      break;

    case 'SUSPENDED':
      smsContent = `Hello ${fullName}, your CivicTree Affiliate channel (${affiliateCode}) has been SUSPENDED by administration. Please contact support on 0556069880 for details.`;
      emailSubject = `Important Notice: CivicTree Affiliate Account Suspended (${affiliateCode})`;
      badgeColor = '#ef6c00';
      badgeText = 'SUSPENDED';
      mainHeadline = 'Your Affiliate Account is Temporarily Suspended';
      subMessage = `Please be notified that your CivicTree affiliate channel (${affiliateCode}) has been temporarily suspended by system administration.`;
      actionBoxHtml = `
        <div style="background-color: #fff3e0; border-left: 4px solid #ef6c00; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: #e65100;">While suspended, sales tracking via USSD (${ussdCode}) and portal withdrawal features are temporarily paused. Please reach out to administrative support for assistance.</p>
        </div>
      `;
      break;

    case 'DEACTIVATED':
      smsContent = `Hello ${fullName}, your CivicTree Affiliate account (${affiliateCode}) has been DEACTIVATED. Contact 0556069880 for support.`;
      emailSubject = `Account Deactivation Notice (${affiliateCode})`;
      badgeColor = '#37474f';
      badgeText = 'DEACTIVATED';
      mainHeadline = 'Your Affiliate Account Has Been Deactivated';
      subMessage = `Notice that your CivicTree affiliate account (${affiliateCode}) has been deactivated.`;
      actionBoxHtml = `
        <div style="background-color: #eceff1; border-left: 4px solid #37474f; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: #263238;">If you believe this is an error or wish to reactivate your account, please contact our support team.</p>
        </div>
      `;
      break;

    default:
      return;
  }

  // Ensure SMS content doesn't exceed 245 characters
  if (smsContent.length > 245) {
    smsContent = smsContent.substring(0, 242) + '...';
  }

  // Build Email HTML Template
  const emailHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${emailSubject}</title>
  </head>
  <body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f6f8; color: #333333;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
      <tr>
        <td align="center" style="padding: 30px 15px;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
            
            <!-- Header -->
            <tr>
              <td align="center" style="background: linear-gradient(135deg, #1b5e20 0%, #004d40 100%); padding: 35px 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 0.5px;">CivicTree</h1>
                <p style="color: #a5d6a7; margin: 5px 0 0 0; font-size: 14px; font-weight: 500;">Affiliate Partner Portal</p>
              </td>
            </tr>

            <!-- Content Area -->
            <tr>
              <td style="padding: 35px 30px;">
                
                <!-- Status Badge -->
                <div style="text-align: center; margin-bottom: 25px;">
                  <span style="background-color: ${badgeColor}; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
                    ${badgeText}
                  </span>
                </div>

                <h2 style="color: #2c3e50; font-size: 20px; font-weight: 600; margin: 0 0 15px 0; text-align: center;">
                  ${mainHeadline}
                </h2>

                <p style="font-size: 15px; line-height: 1.6; color: #4a5568; margin: 0 0 20px 0;">
                  Dear <strong>${fullName}</strong>,
                </p>

                <p style="font-size: 15px; line-height: 1.6; color: #4a5568; margin: 0 0 20px 0;">
                  ${subMessage}
                </p>

                ${actionBoxHtml}

                <!-- Account Information Summary Card -->
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; margin: 25px 0;">
                  <tr>
                    <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Affiliate Code:</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #1e293b; padding-bottom: 8px;">${affiliateCode}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Assigned USSD:</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #2e7d32; padding-bottom: 8px;">${ussdCode}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; color: #64748b;">Payout Method:</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #1e293b;">${profile.payoutMethod === 'MOBILE_MONEY' ? 'Mobile Money' : 'Bank Account'}</td>
                  </tr>
                </table>

                <p style="font-size: 14px; line-height: 1.5; color: #718096; margin: 25px 0 0 0; text-align: center;">
                  Need assistance? Contact our support team via call or WhatsApp on <strong>0556069880</strong> or reply directly to this email.
                </p>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="background-color: #f8fafc; border-top: 1px solid #edf2f7; padding: 20px; text-align: center;">
                <p style="margin: 0; font-size: 12px; color: #a0aec0;">
                  &copy; ${new Date().getFullYear()} CivicTree. All rights reserved.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  // Dispatch Notifications Async (Does not throw errors to block controller execution)
  try {
    if (phoneNumber) {
      sendSMS({ to: phoneNumber, message: smsContent }).catch(err =>
        console.error(`[AFFILIATE SMS ERROR] Failed for ${phoneNumber}:`, err.message)
      );
    }
  } catch (err) {
    console.error(`[AFFILIATE SMS EXCEPTION]:`, err.message);
  }

  try {
    if (email) {
      sendEmail({ to: email, subject: emailSubject, html: emailHtml }).catch(err =>
        console.error(`[AFFILIATE EMAIL ERROR] Failed for ${email}:`, err.message)
      );
    }
  } catch (err) {
    console.error(`[AFFILIATE EMAIL EXCEPTION]:`, err.message);
  }
};

/**
 * Notifies all active administrators via SMS, HTML Email, and system push notifications
 * when a new affiliate application is submitted.
 * 
 * @param {Object} params
 * @param {Object} params.user - New affiliate user (fullName, email, phoneNumber)
 * @param {Object} params.profile - New affiliate profile
 */
export const notifyAdminsNewAffiliateApplication = async ({ user, profile }) => {
  if (!user || !profile) return;

  try {
    const fullName = user.fullName || 'Applicant';
    const email = user.email || 'N/A';
    const phoneNumber = user.phoneNumber || 'N/A';
    const affiliateCode = profile.affiliateCode || 'N/A';
    const businessName = profile.businessName || 'N/A';
    const location = profile.location || 'N/A';
    const payoutMethod = profile.payoutMethod === 'MOBILE_MONEY' ? 'Mobile Money' : 'Bank Account';

    let accountDetailsSummary = '';
    if (profile.payoutMethod === 'MOBILE_MONEY') {
      accountDetailsSummary = `${profile.momoNetwork || ''} - ${profile.momoNumber || ''} (${profile.momoAccountName || ''})`;
    } else {
      accountDetailsSummary = `${profile.bankName || ''} - ${profile.bankAccountNumber || ''} (${profile.bankAccountName || ''})`;
    }

    // 1. Fetch all active administrators
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true, fullName: true, email: true, phoneNumber: true }
    });

    if (!admins || admins.length === 0) return;

    // 2. Build Short SMS for Admins (Strictly <= 245 characters)
    let smsContent = `NEW AFFILIATE APP! Code: ${affiliateCode}, Name: ${fullName}, Phone: ${phoneNumber}, Payout: ${payoutMethod}. Log into Admin Portal to review & approve.`;
    if (smsContent.length > 245) {
      smsContent = smsContent.substring(0, 242) + '...';
    }

    // Send SMS to all admins with phone numbers
    const adminPhones = admins.map(a => a.phoneNumber).filter(Boolean);
    if (adminPhones.length > 0) {
      sendBatchSMS({ recipients: adminPhones, message: smsContent }).catch(err =>
        console.error('[ADMIN AFFILIATE APP SMS ERROR]:', err.message)
      );
    }

    // 3. Build HTML Email Template for Admins
    const emailSubject = `🔔 New Affiliate Application: ${fullName} (${affiliateCode})`;
    const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${emailSubject}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f6f8; color: #333333;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
        <tr>
          <td align="center" style="padding: 30px 15px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
              
              <!-- Header -->
              <tr>
                <td align="center" style="background: linear-gradient(135deg, #1b5e20 0%, #004d40 100%); padding: 30px 20px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">CivicTree Admin Portal</h1>
                  <p style="color: #a5d6a7; margin: 5px 0 0 0; font-size: 13px; font-weight: 500;">Affiliate Application Alert</p>
                </td>
              </tr>

              <!-- Content Area -->
              <tr>
                <td style="padding: 30px;">
                  
                  <div style="text-align: center; margin-bottom: 20px;">
                    <span style="background-color: #f57c00; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
                      PENDING REVIEW
                    </span>
                  </div>

                  <h2 style="color: #1e293b; font-size: 20px; font-weight: 600; margin: 0 0 15px 0; text-align: center;">
                    New Affiliate Application Submitted
                  </h2>

                  <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px 0;">
                    A new partner has registered for the CivicTree Affiliate Program and is awaiting administrative approval and USSD assignment.
                  </p>

                  <!-- Application Details Table -->
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 18px; margin: 20px 0;">
                    <tr>
                      <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Affiliate Code:</td>
                      <td align="right" style="font-size: 14px; font-weight: bold; color: #1e293b; padding-bottom: 8px;">${affiliateCode}</td>
                    </tr>
                    <tr>
                      <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Full Name:</td>
                      <td align="right" style="font-size: 14px; font-weight: bold; color: #1e293b; padding-bottom: 8px;">${fullName}</td>
                    </tr>
                    <tr>
                      <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Business Name:</td>
                      <td align="right" style="font-size: 14px; color: #1e293b; padding-bottom: 8px;">${businessName}</td>
                    </tr>
                    <tr>
                      <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Phone Number:</td>
                      <td align="right" style="font-size: 14px; font-weight: bold; color: #1e293b; padding-bottom: 8px;">${phoneNumber}</td>
                    </tr>
                    <tr>
                      <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Email Address:</td>
                      <td align="right" style="font-size: 14px; color: #1e293b; padding-bottom: 8px;">${email}</td>
                    </tr>
                    <tr>
                      <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Location:</td>
                      <td align="right" style="font-size: 14px; color: #1e293b; padding-bottom: 8px;">${location}</td>
                    </tr>
                    <tr>
                      <td style="font-size: 13px; color: #64748b; padding-bottom: 8px;">Payout Method:</td>
                      <td align="right" style="font-size: 14px; font-weight: bold; color: #2e7d32; padding-bottom: 8px;">${payoutMethod}</td>
                    </tr>
                    <tr>
                      <td style="font-size: 13px; color: #64748b;">Payout Account:</td>
                      <td align="right" style="font-size: 13px; color: #334155;">${accountDetailsSummary}</td>
                    </tr>
                  </table>

                  <p style="font-size: 14px; line-height: 1.5; color: #64748b; margin: 20px 0 0 0; text-align: center;">
                    Please log into your Admin Dashboard under <strong>Affiliate Management</strong> to review details, assign a USSD code, and update status to Approved or Rejected.
                  </p>

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="background-color: #f8fafc; border-top: 1px solid #edf2f7; padding: 18px; text-align: center;">
                  <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                    &copy; ${new Date().getFullYear()} CivicTree System Administration.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

    // Send Email to all admins
    admins.forEach(admin => {
      if (admin.email) {
        sendEmail({ to: admin.email, subject: emailSubject, html: emailHtml }).catch(err =>
          console.error(`[ADMIN AFFILIATE EMAIL ERROR] Failed for ${admin.email}:`, err.message)
        );
      }
    });

    // 4. System Push & In-App Notification for all admins
    notifyAllAdmins({
      title: 'New Affiliate Application',
      message: `Affiliate application submitted by ${fullName} (${affiliateCode}). Pending approval.`,
      type: 'AFFILIATE',
      sendPush: true
    }).catch(err => console.error('[ADMIN PUSH ERROR]:', err.message));

  } catch (error) {
    console.error('[NOTIFY ADMINS NEW AFFILIATE EXCEPTION]:', error.message);
  }
};
