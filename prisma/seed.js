import { PrismaClient } from '../generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const MIN_SEED_PASSWORD_LENGTH = 12;

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  // No fallback credentials: a default password in source code is a known login for anyone who reads it.
  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment to seed the admin user.');
  }
  if (adminPassword.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters long.`);
  }

  console.log(`Seeding Admin user: ${adminEmail}...`);

  // Check if admin already exists
  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { email: adminEmail },
        { role: 'ADMIN' }
      ]
    }
  });

  if (existingAdmin) {
    console.log(`An admin user already exists: ${existingAdmin.email} (${existingAdmin.role})`);
    return;
  }

  // Hash the admin password using bcryptjs
  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  // Create the admin user
  const admin = await prisma.user.create({
    data: {
      fullName: 'System Administrator',
      email: adminEmail,
      password: hashedPassword,
      role: 'ADMIN',
      firstTimeLogin: false, // Seeded admin does not need first-time setup
      isActive: true
    }
  });

  console.log(`Successfully seeded Admin user!`);
  console.log(`ID: ${admin.id}`);
  console.log(`Email: ${admin.email}`);
}

main()
  .catch((e) => {
    console.error('Error seeding admin user:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
