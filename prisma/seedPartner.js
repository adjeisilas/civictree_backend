import { prisma } from '../config/config.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const MIN_SEED_PASSWORD_LENGTH = 12;

export async function seedPartner() {
  const partnerEmail = process.env.PARTNER_EMAIL;
  const partnerPassword = process.env.PARTNER_PASSWORD;

  // No fallback credentials: a default password in source code is a known login for anyone who reads it.
  // Note: re-running this script resets the partner's password to PARTNER_PASSWORD.
  if (!partnerEmail || !partnerPassword) {
    throw new Error('PARTNER_EMAIL and PARTNER_PASSWORD must be set in the environment to seed the partner account.');
  }
  if (partnerPassword.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`PARTNER_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters long.`);
  }
  const partnerPhone = '0599745043';
  const partnerName = 'BOATENG OWUSU';

  console.log(`Seeding default Partner account: ${partnerEmail} (${partnerName})...`);

  // 1. Ensure Partner User account exists in User table
  let partnerUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: partnerEmail },
        { phoneNumber: partnerPhone }
      ]
    }
  });

  const hashedPassword = await bcrypt.hash(partnerPassword, 12);

  if (!partnerUser) {
    partnerUser = await prisma.user.create({
      data: {
        fullName: partnerName,
        email: partnerEmail,
        phoneNumber: partnerPhone,
        password: hashedPassword,
        role: 'PARTNER',
        firstTimeLogin: false,
        isActive: true
      }
    });
    console.log(`Created Partner user: ${partnerUser.email}`);
  } else {
    partnerUser = await prisma.user.update({
      where: { id: partnerUser.id },
      data: {
        role: 'PARTNER',
        password: hashedPassword,
        fullName: partnerName,
        phoneNumber: partnerPhone,
        isActive: true
      }
    });
    console.log(`Updated existing user to PARTNER role: ${partnerUser.email}`);
  }

  // 2. Ensure Partner profile exists in Partner table
  let partnerProfile = await prisma.partner.findFirst({
    where: {
      OR: [
        { email: partnerEmail },
        { phone: partnerPhone },
        { partnerId: 'PRT-8801' }
      ]
    }
  });

  if (!partnerProfile) {
    partnerProfile = await prisma.partner.create({
      data: {
        partnerId: 'PRT-8801',
        partnerName: partnerName,
        legalEntityName: 'Boateng Owusu Revenue Partners',
        email: partnerEmail,
        phone: partnerPhone,
        passwordHash: hashedPassword,
        contractRef: 'CTR-REV-2026-01',
        sharePercentage: 6.67, // Calculated as: (1.00 / (30 - 15)) * 100 = 6.67%
        status: 'Active',
        lifetimeShareEarnings: 0,
        availableBalance: 0,
        withdrawnAmount: 0
      }
    });
    console.log(`Created Partner profile with ID ${partnerProfile.partnerId}`);
  } else {
    partnerProfile = await prisma.partner.update({
      where: { id: partnerProfile.id },
      data: {
        partnerName: partnerName,
        phone: partnerPhone,
        email: partnerEmail,
        passwordHash: hashedPassword,
        sharePercentage: 6.67,
        status: 'Active'
      }
    });
    console.log(`Updated Partner profile: ${partnerProfile.partnerId}`);
  }

  // 3. Ensure Default Payout Account exists
  const existingPayout = await prisma.partnerPayoutAccount.findFirst({
    where: { partnerId: partnerProfile.id }
  });

  if (!existingPayout) {
    await prisma.partnerPayoutAccount.create({
      data: {
        partnerId: partnerProfile.id,
        type: 'MOMO',
        provider: 'MTN Mobile Money',
        accountNumber: partnerPhone,
        accountName: partnerName,
        isDefault: true
      }
    });
    console.log(`Seeded default MoMo payout account: ${partnerPhone} (${partnerName})`);
  }

  // 4. Ensure Partner Settings exist
  await prisma.partnerSetting.upsert({
    where: { partnerId: partnerProfile.id },
    update: {
      defaultPayoutAccountId: existingPayout ? existingPayout.id : undefined,
      autoSettlementEnabled: true,
      settlementFrequency: 'DAILY'
    },
    create: {
      partnerId: partnerProfile.id,
      autoSettlementEnabled: true,
      settlementFrequency: 'DAILY',
      emailDailyDigest: true,
      emailPayoutAlerts: true,
      smsSurgeAlerts: true,
      smsPayoutAlerts: true
    }
  });

  console.log(`Successfully seeded Partner:`);
  console.log(`- Name: ${partnerName}`);
  console.log(`- Phone: ${partnerPhone}`);
  console.log(`- Email: ${partnerEmail}`);

  return partnerProfile;
}

// Execute if run directly
if (process.argv[1].endsWith('seedPartner.js')) {
  seedPartner()
    .catch(err => {
      console.error('Error seeding partner:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
