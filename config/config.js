import dotenv from 'dotenv';
import { PrismaClient } from '../generated/prisma/index.js';

dotenv.config();

// JWT secrets must be long random values. A missing, short, or placeholder
// secret lets anyone forge login tokens, so refuse to start instead.
const MIN_JWT_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRET_PATTERN = /^(your|change|replace|secret|placeholder|example)/i;

const requireStrongSecret = (name) => {
  const value = process.env[name];
  if (!value || value.length < MIN_JWT_SECRET_LENGTH || PLACEHOLDER_SECRET_PATTERN.test(value)) {
    throw new Error(
      `${name} is missing or too weak. Set it to a random value of at least ${MIN_JWT_SECRET_LENGTH} characters, ` +
      `e.g. node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
    );
  }
  return value;
};

const jwtAccessSecret = requireStrongSecret('JWT_ACCESS_SECRET');
const jwtRefreshSecret = requireStrongSecret('JWT_REFRESH_SECRET');

if (jwtAccessSecret === jwtRefreshSecret) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  apiUrl: process.env.API_URL || 'https://civitree-backend.onrender.com',
  frontendUrl: process.env.FRONTEND_URL || 'https://civitree.com',
  jwt: {
    accessSecret: jwtAccessSecret,
    refreshSecret: jwtRefreshSecret,
  },
  email: {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    email: process.env.EMAIL_USER
      ? (process.env.EMAIL_USER.startsWith('mailto:') || process.env.EMAIL_USER.startsWith('http') ? process.env.EMAIL_USER : `mailto:${process.env.EMAIL_USER}`)
      : 'mailto:peterasemani1957@gmail.com'
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY
  },
  sms: {
    clientId: process.env.HUBTEL_SMS_CLIENT_ID,
    clientSecret: process.env.HUBTEL_SMS_CLIENT_SECRET,
    senderId: process.env.HUBTEL_SMS_SENDER_ID || 'CivicTree'
  },
  hubtel: {
    apiId: process.env.HUBTEL_PAYMENT_API_ID,
    apiKey: process.env.HUBTEL_PAYMENT_API_KEY,
    merchantAccountNumber: process.env.HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER,
    callbackToken: process.env.HUBTEL_CALLBACK_TOKEN || null,
    disbursementAccountNumber:process.env.HUBTEL_PAYMENT_DISBURSEMENT_ACCOUNT_NUMBER || process.env.HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER,
    returnUrl: process.env.HUBTEL_RETURN_URL || `${process.env.FRONTEND_URL || 'https://civitree.com'}/payment-success`,
    cancellationUrl: process.env.HUBTEL_CANCEL_URL || `${process.env.FRONTEND_URL || 'https://civitree.com'}/payment-failed`
  }
};

export { prisma };
export default config;
