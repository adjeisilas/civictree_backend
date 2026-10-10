/**
 * Restores a dump written by scripts/backup_database.js.
 *
 * A restore overwrites everything in the target database, so this script will
 * not touch the database named in DATABASE_URL unless you pass --i-know, and
 * it refuses outright on a remote host unless you also pass --remote. Restoring
 * into a fresh database first and checking it is the safer habit.
 *
 * Usage:
 *   node scripts/restore_database.js --file=backups/civictree-....sql.gz --into=civictree_restore_test
 *   node scripts/restore_database.js --file=<dump> --i-know          # over the live database
 */
import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { PassThrough } from 'node:stream';
import {
  parseDatabaseUrl,
  withDefaultsFile,
  run,
  query,
  flag,
  looksRemote,
  CORE_TABLES
} from './lib/mysqlCli.js';

/** A gzipped dump is decompressed on the way in; a plain .sql is passed through. */
function openDump(file) {
  const raw = createReadStream(file);
  if (!file.endsWith('.gz')) return raw;

  const out = new PassThrough();
  raw.pipe(createGunzip()).pipe(out);
  return out;
}

/** mysql rejects a database name it cannot quote, so allow only plain names. */
function assertSafeName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`"${name}" is not a usable database name (letters, digits and underscores only).`);
  }
  return name;
}

export async function restoreInto(connection, database, file) {
  await query(connection, `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await withDefaultsFile(connection, (defaultsFile) =>
    run('mysql', [`--defaults-file=${defaultsFile}`, database], { stdinStream: openDump(file) })
  );
}

/** Row count per table, with null for a table the restore did not create. */
export async function tableCounts(connection, database, tables = CORE_TABLES) {
  const counts = {};

  for (const table of tables) {
    try {
      const out = await query(connection, `SELECT COUNT(*) FROM \`${table}\``, { database });
      counts[table] = Number(out.trim());
    } catch {
      counts[table] = null;
    }
  }

  return counts;
}

async function main() {
  const file = flag('file');
  if (!file) {
    throw new Error('Pass the dump to restore: --file=backups/civictree-....sql.gz');
  }
  await stat(file); // fails clearly if the path is wrong

  const connection = parseDatabaseUrl(process.env.DATABASE_URL);
  const into = flag('into');
  const overwriteLive = process.argv.includes('--i-know');

  let target;
  if (into) {
    target = assertSafeName(into);
    if (target === connection.database && !overwriteLive) {
      throw new Error(`--into names the database DATABASE_URL points at. Add --i-know if that is really the intent.`);
    }
  } else if (overwriteLive) {
    target = connection.database;
  } else {
    throw new Error(
      'Choose a target: --into=<new_database_name> to restore beside the live data, ' +
      'or --i-know to overwrite ' + connection.database + '.'
    );
  }

  if (target === connection.database && looksRemote(connection) && !process.argv.includes('--remote')) {
    throw new Error(`Refusing to overwrite ${target} on remote host ${connection.host} without --remote.`);
  }

  console.log(`Restoring ${file}`);
  console.log(`  into ${target} at ${connection.host}:${connection.port}`);
  if (target === connection.database) {
    console.log('  WARNING: this is the database the application is configured to use.');
  }

  await restoreInto(connection, target, file);

  const counts = await tableCounts(connection, target);
  console.log('\nRestored row counts:');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(20)} ${count === null ? 'table missing' : count}`);
  }

  const missing = Object.entries(counts).filter(([, count]) => count === null).map(([table]) => table);
  if (missing.length > 0) {
    throw new Error(`The dump did not contain: ${missing.join(', ')}`);
  }

  console.log('\nRestore finished.');
}

// Only runs the CLI when invoked directly, so verify_backup.js can import the
// helpers. pathToFileURL does the encoding a hand-rolled comparison gets wrong:
// a path containing spaces arrives percent-encoded in import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nRestore failed: ${err.message}`);
    process.exit(1);
  });
}
