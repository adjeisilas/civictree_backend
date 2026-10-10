/**
 * Takes a compressed, consistent dump of the database in DATABASE_URL.
 *
 * `--single-transaction` means the dump is a snapshot of one moment without
 * locking the tables, so this is safe to run against a live database.
 *
 * A backup nobody has restored is not a backup. Run `npm run db:verify-backup`
 * after this — it restores the file into a scratch database and compares row
 * counts against the source.
 *
 * Usage:
 *   npm run db:backup                      # into ./backups
 *   node scripts/backup_database.js --out=/srv/backups --keep-days=14
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import {
  parseDatabaseUrl,
  withDefaultsFile,
  run,
  flag,
  looksRemote
} from './lib/mysqlCli.js';

const DEFAULT_KEEP_DAYS = 30;

/** 2026-10-02T14-07-33 — sorts chronologically and is a legal filename. */
function timestamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Deletes old dumps so a backup directory cannot fill the disk unattended. */
async function prune(directory, keepDays) {
  if (keepDays <= 0) return [];

  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const removed = [];

  for (const name of await readdir(directory)) {
    if (!name.startsWith('civictree-') || !name.endsWith('.sql.gz')) continue;

    const file = path.join(directory, name);
    const info = await stat(file);
    if (info.mtimeMs < cutoff) {
      await unlink(file);
      removed.push(name);
    }
  }

  return removed;
}

async function main() {
  const connection = parseDatabaseUrl(process.env.DATABASE_URL);
  const outDir = path.resolve(flag('out', 'backups'));
  const keepDays = Number(flag('keep-days', DEFAULT_KEEP_DAYS));

  if (!Number.isFinite(keepDays)) {
    throw new Error('--keep-days must be a number.');
  }

  await mkdir(outDir, { recursive: true });

  const target = path.join(outDir, `civictree-${connection.database}-${timestamp()}.sql.gz`);

  console.log(`Backing up ${connection.database} at ${connection.host}:${connection.port}`);
  if (looksRemote(connection)) {
    console.log('  (remote host — the dump travels over the network, so expect this to take longer)');
  }

  await withDefaultsFile(connection, async (defaultsFile) => {
    const gzip = createGzip({ level: 9 });
    const file = createWriteStream(target);
    const written = pipeline(gzip, file);

    await run('mysqldump', [
      `--defaults-file=${defaultsFile}`,
      '--single-transaction',   // consistent snapshot without locking
      '--quick',                // stream rows instead of buffering them
      '--routines',
      '--triggers',
      '--events',
      '--no-tablespaces',       // avoids needing the PROCESS privilege
      '--set-gtid-purged=OFF',  // the dump stays restorable into any server
      '--default-character-set=utf8mb4',
      connection.database
    ], { stdoutStream: gzip });

    await written;
  });

  const info = await stat(target);
  if (info.size === 0) {
    await unlink(target);
    throw new Error('The dump came out empty; nothing was written.');
  }

  console.log(`\nWrote ${target}`);
  console.log(`  size: ${formatSize(info.size)}`);

  const removed = await prune(outDir, keepDays);
  if (removed.length > 0) {
    console.log(`  pruned ${removed.length} backup(s) older than ${keepDays} days`);
  }

  console.log('\nNext: node scripts/verify_backup.js --file=' + path.basename(target));
}

main().catch((err) => {
  console.error(`\nBackup failed: ${err.message}`);
  process.exit(1);
});
