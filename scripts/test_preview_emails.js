import { sendEmail } from '../utils/email/email.js';

async function sendPreview() {
  // ====================================================
  // EDIT THIS EMAIL TO PREVIEW THE TEMPLATES IN YOUR INBOX
  // ====================================================
  const previewRecipient = 'joshuaasemani27@gmail.com';

  console.log(`=== PREVIEWING CIVITREE EMAIL TEMPLATES ===`);
  console.log(`Sending previews to: ${previewRecipient}\n`);

  // 1. Password Reset OTP Template
  console.log('Sending Password Reset OTP template...');
  const otpCode = '123456';
  const otpEmailHtml = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4A90E2; margin-top: 0;">Password Reset OTP Code</h2>
      <p>Hello Test User,</p>
      <p>We received a request to reset your password. Use the following 6-digit One-Time Password (OTP) to proceed. This code is valid for 10 minutes.</p>
      <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; border-radius: 4px; margin: 20px 0;">
        ${otpCode}
      </div>
      <p>If you did not request a password reset, please ignore this email.</p>
    </div>
  `;

  await sendEmail({
    to: previewRecipient,
    subject: 'Password Reset OTP - CivicTree (Preview)',
    html: otpEmailHtml
  });
  console.log('OTP Template Sent!\n');

  // 2. Low Stock Alert Template
  console.log('Sending Low Stock Alert template...');
  const lowStockHtml = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #D0021B; margin-top: 0;">Low Stock Alert</h2>
      <p>Dear Admin (Test Admin),</p>
      <p>This is an automated notification that the result checker voucher stock for <strong>WASSCE</strong> is low.</p>
      <ul style="line-height: 1.6;">
        <li><strong>Current Available Count:</strong> 5</li>
        <li><strong>Configured Warning Threshold:</strong> 50</li>
      </ul>
      <p>Please log in to the admin dashboard and upload a new voucher batch to avoid service interruption.</p>
    </div>
  `;

  await sendEmail({
    to: previewRecipient,
    subject: '[ALERT] Low Voucher Stock - WASSCE (Preview)',
    html: lowStockHtml
  });
  console.log('Low Stock Alert Template Sent!\n');

  console.log('=== Done! Check your inbox. ===');
}

sendPreview().catch(console.error);
