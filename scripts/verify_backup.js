/**
 * Proves a backup is restorable.
 *
 * Restores the dump into a scratch database, compares row counts against the
 * live database table by table, then drops the scratch database. Nothing in
 * the live database is written to.
 *
 * Run this after every backup and keep the output: an untested backup is only a
 * guess. Counts may drift upward on the live side because rows arrive while the
 * dump is being written, so the check fails when the restored copy has FEWER
 * rows than it should, or a table is missing entirely.
 *
 * Credentials: the application's database user is scoped to one database and
 * cannot create another, which is how it should stay. Either set
 * VERIFY_DATABASE_URL to a user that may create the scratch database, or grant
 * the app user rights on that one name — the script prints the exact statement
 * if it is denied.
 *
 * Usage:
 *   npm run db:verify-backup                                  # newest dump in ./backups
 *   node scripts/verify_backup.js --file=<dump> --keep         # leave the scratch database behind
 *   node scripts/verify_backup.js --scratch=restore_check      # different scratch name
 */
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseDatabaseUrl, query, flag, CORE_TABLES } from './lib/mysqlCli.js';
import { restoreInto, tableCounts } from './restore_database.js';

/** Falls back to the newest dump in ./backups when --file is not given. */
async function newestBackup(directory = 'backups') {
  let names;
  try {
    names = (await readdir(directory))
      .filter((name) => name.startsWith('civictree-') && name.endsWith('.sql.gz'))
      .sort();
  } catch {
    throw new Error(`No ${directory} directory yet. Run npm run db:backup first.`);
  }

  if (names.length === 0) {
    throw new Error(`No backups found in ${directory}. Run npm run db:backup first.`);
  }

  return path.join(directory, names[names.length - 1]);
}

/** Spells out the grant that lets the app user run this without a second account. */
function grantHint(connection, scratch) {
  return [
    '',
    'The database user cannot create the scratch database. Either point',
    'VERIFY_DATABASE_URL at a privileged user, or run this once as an administrator:',
    '',
    `  CREATE DATABASE IF NOT EXISTS \`${scratch}\``,
    '    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
    `  GRANT ALL PRIVILEGES ON \`${scratch}\`.* TO '${connection.user}'@'${connection.host}';`,
    '  FLUSH PRIVILEGES;',
    '',
    'Do not widen the application user beyond that one name.'
  ].join('\n');
}

async function main() {
  const file = flag('file') || (await newestBackup());
  await stat(file);

  // The live database to compare against always comes from DATABASE_URL
  const live = parseDatabaseUrl(process.env.DATABASE_URL);

  // The restore may need a different, more privileged account
  const restoreConnection = process.env.VERIFY_DATABASE_URL
    ? parseDatabaseUrl(process.env.VERIFY_DATABASE_URL)
    : live;

  const scratch = flag('scratch', `${live.database}_verify`);
  const keep = process.argv.includes('--keep');

  console.log(`Verifying ${file}`);
  console.log(`  source:  ${live.database} at ${live.host}:${live.port}`);
  console.log(`  scratch: ${scratch} (as ${restoreConnection.user})\n`);

  if (scratch === live.database) {
    throw new Error('The scratch database must not be the live one.');
  }

  const liveCounts = await tableCounts(live, live.database);

  let restoredCounts;
  try {
    // A leftover scratch database from an interrupted run would skew the counts
    await query(restoreConnection, `DROP DATABASE IF EXISTS \`${scratch}\``);
    await restoreInto(restoreConnection, scratch, file);
    restoredCounts = await tableCounts(restoreConnection, scratch);
  } catch (err) {
    if (/Access denied|ERROR 1044|ERROR 1045/.test(err.message)) {
      throw new Error(`${err.message}\n${grantHint(restoreConnection, scratch)}`);
    }
    throw err;
  } finally {
    if (keep) {
      console.log(`Leaving ${scratch} in place (--keep).\n`);
    } else {
      await query(restoreConnection, `DROP DATABASE IF EXISTS \`${scratch}\``).catch(() => {});
    }
  }

  const problems = [];
  console.log('table                   live  restored');
  console.log('---------------------------------------');

  for (const table of CORE_TABLES) {
    const liveCount = liveCounts[table];
    const restoredCount = restoredCounts[table];

    let note = '';
    if (restoredCount === null) {
      note = '  MISSING';
      problems.push(`${table} is not in the backup`);
    } else if (liveCount !== null && restoredCount < liveCount) {
      // Rows written after the snapshot explain a small gap; a large one does not
      const gap = liveCount - restoredCount;
      note = `  -${gap}`;
      if (gap > Math.max(5, liveCount * 0.01)) {
        problems.push(`${table} is short by ${gap} row(s)`);
      }
    }

    console.log(
      `${table.padEnd(22)} ${String(liveCount ?? '-').padStart(5)} ${String(restoredCount ?? '-').padStart(9)}${note}`
    );
  }

  if (problems.length > 0) {
    console.error('\nThis backup is NOT trustworthy:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log('\nBackup restores cleanly and the data is all there.');
}

main().catch((err) => {
  console.error(`\nVerification failed: ${err.message}`);
  process.exit(1);
});
