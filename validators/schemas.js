import { z } from 'zod';
import { MAX_VOUCHERS_PER_ORDER } from '../utils/order/orderHelpers.js';

// ---- Shared field rules -------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 10;

export const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email address is too long')
  .pipe(z.email({ error: 'Please provide a valid email address' }));

// Ghana numbers: 0XXXXXXXXX, 233XXXXXXXXX or +233XXXXXXXXX
// Spaces and dashes are removed first, so "024 123 4567" is accepted and stored as "0241234567".
const stripPhoneFormatting = (value) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value);
const blankToNull = (value) => (typeof value === 'string' && value.trim() === '' ? null : value);

export const ghanaPhone = z.preprocess(
  stripPhoneFormatting,
  z
    .string({ error: 'Phone number is required' })
    .regex(/^(\+?233|0)\d{9}$/, 'Please provide a valid Ghana phone number, e.g. 0241234567')
);

// Optional phone number: an empty form field counts as "not provided"
export const optionalGhanaPhone = z.preprocess(blankToNull, ghanaPhone.nullable().optional());

// Used when a password is being chosen
export const newPassword = z
  .string({ error: 'Password is required' })
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`)
  .max(128, 'Password must be at most 128 characters long');

// Used when checking an existing password (older accounts may predate the current policy)
const existingPassword = z
  .string({ error: 'Password is required' })
  .min(1, 'Password is required')
  .max(128, 'Password is too long');

const otpCode = z
  .string({ error: 'OTP code is required' })
  .trim()
  .regex(/^\d{6}$/, 'OTP code must be 6 digits');

const token = z.string({ error: 'Refresh token is required' }).min(1, 'Refresh token is required').max(1024);

const optionalText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

// ---- Auth ---------------------------------------------------------------------

export const loginSchema = z.object({
  email,
  password: existingPassword
});

export const refreshSchema = z.object({
  refreshToken: token
});

export const forgotPasswordSchema = z.object({
  email
});

export const validateOtpSchema = z.object({
  email,
  otp: otpCode
});

export const resetPasswordSchema = z
  .object({
    email,
    otp: otpCode,
    newPassword,
    confirmPassword: z.string({ error: 'Please confirm your new password' })
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword']
  });

export const changePasswordSchema = z
  .object({
    currentPassword: existingPassword,
    newPassword,
    confirmPassword: z.string({ error: 'Please confirm your new password' })
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    error: 'New password and confirmation do not match',
    path: ['confirmPassword']
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    error: 'New password must be different from the current password',
    path: ['newPassword']
  });

export const affiliateRegisterSchema = z
  .object({
    fullName: z.string({ error: 'Full name is required' }).trim().min(2, 'Full name is required').max(120),
    businessName: optionalText(120),
    phoneNumber: ghanaPhone,
    email,
    location: optionalText(120),
    password: newPassword,
    payoutMethod: z.enum(['MOBILE_MONEY', 'BANK_ACCOUNT'], { error: 'Payout method must be MOBILE_MONEY or BANK_ACCOUNT' }),
    momoNetwork: optionalText(40),
    momoNumber: optionalGhanaPhone,
    momoAccountName: optionalText(120),
    bankName: optionalText(80),
    bankAccountNumber: z.preprocess(
      (value) => blankToNull(stripPhoneFormatting(value)),
      z.string().regex(/^\d{6,20}$/, 'Please provide a valid bank account number').nullable().optional()
    ),
    bankAccountName: optionalText(120)
  })
  .superRefine((data, ctx) => {
    if (data.payoutMethod === 'MOBILE_MONEY' && (!data.momoNetwork || !data.momoNumber || !data.momoAccountName)) {
      ctx.addIssue({ code: 'custom', message: 'Mobile Money network, MoMo number, and account name are required.', path: ['momoNumber'] });
    }
    if (data.payoutMethod === 'BANK_ACCOUNT' && (!data.bankName || !data.bankAccountNumber || !data.bankAccountName)) {
      ctx.addIssue({ code: 'custom', message: 'Bank name, account number, and account name are required.', path: ['bankAccountNumber'] });
    }
  });

// ---- Orders -------------------------------------------------------------------

export const createOrderSchema = z.object({
  voucherType: z.enum(['WASSCE_NOVDEC', 'BECE'], { error: 'Invalid voucher type. Must be WASSCE_NOVDEC or BECE.' }),
  quantity: z.coerce
    .number({ error: 'Quantity must be a number' })
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(MAX_VOUCHERS_PER_ORDER, `You can buy at most ${MAX_VOUCHERS_PER_ORDER} vouchers per order.`),
  phoneNumber: ghanaPhone,
  customerName: optionalText(120),
  // Web checkout always records WEB; USSD orders are created by the USSD handlers
  channel: z.string().optional()
});

// ---- Admin user management ----------------------------------------------------

// Roles an admin may give an account here. Affiliate and partner accounts are managed in their own screens.
export const ASSIGNABLE_ROLES = ['USER', 'ADMIN'];
const ALL_ROLES = ['USER', 'ADMIN', 'AFFILIATE', 'PARTNER'];

export const createUserSchema = z.object({
  fullName: z.string({ error: 'Full name is required' }).trim().min(2, 'Full name is required').max(120),
  email,
  password: newPassword,
  phoneNumber: optionalGhanaPhone,
  role: z.enum(ASSIGNABLE_ROLES, { error: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` })
});

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: email.optional(),
  phoneNumber: optionalGhanaPhone,
  // Any existing role may be sent back unchanged; the controller only allows changing to ASSIGNABLE_ROLES
  role: z.enum(ALL_ROLES, { error: `Role must be one of: ${ALL_ROLES.join(', ')}` }).optional(),
  password: newPassword.optional(),
  isActive: z.boolean().optional()
});

// ---- Payouts ------------------------------------------------------------------

const money = (max = 1_000_000) => z.coerce
  .number({ error: 'Amount must be a number' })
  .positive('Amount must be greater than zero')
  .max(max, 'Amount is too large')
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, 'Amount may have at most 2 decimal places');

// Confirms the signed-in user's own password before a sensitive change
const currentPassword = z.string({ error: 'Your account password is required to confirm this action' })
  .min(1, 'Your account password is required to confirm this action')
  .max(128);

export const withdrawalRequestSchema = z.object({
  amount: money()
});

export const processWithdrawalSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED'], { error: 'Status must be APPROVED or REJECTED.' }),
  adminNote: optionalText(500),
  // Required when approving, if the admin has two-factor sign-in switched on
  twoFactorCode: z.string().trim().min(6).max(20).optional()
});

const payoutDestinationFields = {
  payoutMethod: z.enum(['MOBILE_MONEY', 'BANK_ACCOUNT'], { error: 'Invalid payout method. Must be MOBILE_MONEY or BANK_ACCOUNT.' }),
  momoNetwork: optionalText(40),
  momoNumber: optionalGhanaPhone,
  momoAccountName: optionalText(120),
  bankName: optionalText(80),
  bankAccountNumber: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().regex(/^[\d\s-]{6,25}$/, 'Please provide a valid bank account number').nullable().optional()
  ),
  bankAccountName: optionalText(120)
};

const requireDestinationForMethod = (data, ctx) => {
  if (data.payoutMethod === 'MOBILE_MONEY' && (!data.momoNetwork || !data.momoNumber || !data.momoAccountName)) {
    ctx.addIssue({ code: 'custom', message: 'Mobile Money network, MoMo number, and account name are required.', path: ['momoNumber'] });
  }
  if (data.payoutMethod === 'BANK_ACCOUNT' && (!data.bankName || !data.bankAccountNumber || !data.bankAccountName)) {
    ctx.addIssue({ code: 'custom', message: 'Bank name, account number, and account name are required.', path: ['bankAccountNumber'] });
  }
};

export const adminDirectWithdrawalSchema = z
  .object({
    amount: money(),
    currentPassword,
    // Required when the admin has two-factor sign-in switched on
    twoFactorCode: z.string().trim().min(6).max(20).optional(),
    ...payoutDestinationFields
  })
  .superRefine(requireDestinationForMethod);

export const updatePayoutDetailsSchema = z
  .object({ currentPassword, ...payoutDestinationFields })
  .superRefine(requireDestinationForMethod);

export const updateAffiliateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  businessName: optionalText(120),
  location: optionalText(120),
  phoneNumber: optionalGhanaPhone,
  email: email.optional(),
  // Only needed when the email or phone number changes; the controller enforces that
  currentPassword: z.string().max(128).optional()
});

export const partnerSettlementSchema = z.object({
  amount: money(),
  notes: optionalText(500)
});

// ---- Two-factor sign-in --------------------------------------------------------

// Either a 6-digit authenticator code or a recovery code like A1B2C-3D4E5
const twoFactorCode = z
  .string({ error: 'Enter the code from your authenticator app' })
  .trim()
  .min(6, 'Enter the code from your authenticator app')
  .max(20, 'That code is too long');

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string({ error: 'Sign-in session is missing. Please log in again.' }).min(1).max(1024),
  code: twoFactorCode
});

export const twoFactorSetupSchema = z.object({
  currentPassword
});

export const twoFactorEnableSchema = z.object({
  code: z.string({ error: 'Enter the 6-digit code from your authenticator app' }).trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app')
});

export const twoFactorConfirmSchema = z.object({
  currentPassword,
  code: twoFactorCode
});
