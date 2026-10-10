import nodemailer from 'nodemailer';
import config from '../../config/config.js';
import { AppError } from '../error/AppError.js';

// Email is currently OPTIONAL: EMAIL_USER / EMAIL_PASSWORD / GMAIL_* keys were
// removed from .env, so all real transporter/sending logic below is commented
// out and sendEmail() is a no-op. Uncomment this block and the body of
// sendEmail() further down once email credentials are added back.

// // Create nodemailer transporter configured for Gmail OAuth2 or standard SMTP fallback
// const transporterOptions = {
//   service: 'gmail',
//   auth: {}
// };
//
// if (config.email.clientId && config.email.clientSecret && config.email.refreshToken) {
//   transporterOptions.auth = {
//     type: 'OAuth2',
//     user: config.email.user,
//     clientId: config.email.clientId,
//     clientSecret: config.email.clientSecret,
//     refreshToken: config.email.refreshToken
//   };
// } else {
//   transporterOptions.auth = {
//     user: config.email.user,
//     pass: config.email.password
//   };
// }
//
// const transporter = nodemailer.createTransport(transporterOptions);

/**
 * Utility function to send HTML emails.
 * Currently a no-op — email sending is disabled until credentials are
 * configured again. Callers can keep calling this unconditionally; it just
 * logs and resolves instead of sending.
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject line
 * @param {string} options.html - HTML body content
 */
export const sendEmail = async ({ to, subject, html }) => {
  console.warn(`[email] Skipped sending "${subject}" to ${to} — email is disabled (no credentials configured).`);
  return;

  // try {
  //   const mailOptions = {
  //     from: `"CivicTree Support" <${config.email.user}>`,
  //     to,
  //     subject,
  //     html
  //   };
  //
  //   await transporter.sendMail(mailOptions);
  // } catch (error) {
  //   console.error('Email sending failed:', error);
  //   throw new AppError('Failed to send verification email. Please try again later.', 500);
  // }
};
