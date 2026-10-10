/**
 * One-off migration: encrypts voucher PINs that are still stored as plain text.
 *
 * Safe to run more than once — rows that are already encrypted are skipped.
 * Take a database backup first, and make sure SECRET_ENC_KEY is set to its final value:
 * PINs encrypted with one key cannot be read with another.
 *
 * Usage:
 *   node scripts/encrypt_voucher_pins.js --dry-run   # report only
 *   node scripts/encrypt_voucher_pins.js             # convert
 */
import { prisma } from '../config/config.js';
import { encryptPin } from '../utils/voucher/voucherPin.js';
import { isEncrypted, decryptSecret } from '../utils/crypto/secretBox.js';

const BATCH_SIZE = 500;
const dryRun = process.argv.includes('--dry-run');

async function run() {
  const total = await prisma.voucher.count();
  console.log(`Checking ${total} voucher(s)${dryRun ? ' (dry run)' : ''}...`);

  let processed = 0;
  let encrypted = 0;
  let alreadyEncrypted = 0;
  let cursor = null;

  for (;;) {
    const batch = await prisma.voucher.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, pin: true }
    });

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const voucher of batch) {
      processed++;

      if (isEncrypted(voucher.pin)) {
        alreadyEncrypted++;
        continue;
      }

      if (!dryRun) {
        await prisma.voucher.update({
          where: { id: voucher.id },
          data: { pin: encryptPin(voucher.pin) }
        });
      }
      encrypted++;
    }

    console.log(`  processed ${processed}/${total}`);
  }

  console.log('\n=== Voucher PIN encryption ===');
  console.log(`Checked:            ${processed}`);
  console.log(`Already encrypted:  ${alreadyEncrypted}`);
  console.log(dryRun ? `Would encrypt:      ${encrypted}` : `Newly encrypted:    ${encrypted}`);

  if (!dryRun && encrypted > 0) {
    // Read one row back, so a broken key is noticed here rather than at delivery time
    const sample = await prisma.voucher.findFirst({ where: { pin: { startsWith: 'v1.' } }, select: { id: true, pin: true } });
    if (sample) {
      const readable = decryptSecret(sample.pin).length > 0;
      console.log(`Verified one row can be read back: ${readable ? 'yes' : 'NO — STOP AND RESTORE THE BACKUP'}`);
    }
  }
}

run()
  .catch((err) => {
    console.error('Voucher PIN encryption failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
