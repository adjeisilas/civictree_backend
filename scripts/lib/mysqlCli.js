/**
 * Shared plumbing for the backup and restore scripts: reads the connection
 * details out of DATABASE_URL and runs the MySQL command line tools.
 *
 * The password is never passed as an argument. Anyone on the host can read a
 * process's arguments with `ps`, so it goes into a short-lived defaults file
 * that is deleted as soon as the command finishes.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Splits a mysql:// URL into the pieces the command line tools need. */
export function parseDatabaseUrl(url) {
  if (!url) {
    throw new Error('DATABASE_URL is not set. Point it at the database you want to work with.');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  if (parsed.protocol !== 'mysql:') {
    throw new Error(`Only mysql:// URLs are supported here, got ${parsed.protocol}//`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL does not name a database.');
  }

  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port || '3306',
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database
  };
}

/** True when the URL points at something other than a local database. */
export function looksRemote({ host }) {
  return !['127.0.0.1', 'localhost', '::1'].includes(host);
}

/**
 * Writes a [client] defaults file and hands its path to `body`, then removes it.
 * MySQL reads --defaults-file before anything else, so credentials stay off argv.
 */
export async function withDefaultsFile(connection, body) {
  const dir = await mkdtemp(path.join(tmpdir(), 'civictree-my-'));
  const file = path.join(dir, 'client.cnf');

  // Values are quoted because a password may contain # or spaces
  const contents = [
    '[client]',
    `host="${connection.host}"`,
    `port=${connection.port}`,
    `user="${connection.user}"`,
    `password="${connection.password}"`,
    ''
  ].join('\n');

  await writeFile(file, contents, { encoding: 'utf8', mode: 0o600 });

  try {
    return await body(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Runs a command, optionally piping its stdout into `stdoutStream`.
 * Rejects with the tool's own stderr, which is what actually explains failures.
 */
export function run(command, args, { stdoutStream = null, stdinStream = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [stdinStream ? 'pipe' : 'ignore', stdoutStream ? 'pipe' : 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    if (stdoutStream) {
      child.stdout.pipe(stdoutStream);
    } else {
      child.stdout.on('data', (chunk) => { stdout += chunk; });
    }

    if (stdinStream) stdinStream.pipe(child.stdin);

    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      reject(new Error(`Could not run ${command}: ${err.message}. Is it on PATH?`));
    });

    child.on('close', (code) => {
      // mysqldump warns about this on every run and it is not a problem
      const noise = /^(mysqldump|mysql): \[Warning] Using a password/gm;
      const cleaned = stderr.replace(noise, '').trim();

      if (code === 0) return resolve({ stdout, stderr: cleaned });
      reject(new Error(`${command} exited with code ${code}${cleaned ? `:\n${cleaned}` : ''}`));
    });
  });
}

/** Runs one statement with the mysql client and returns its raw output. */
export async function query(connection, sql, { database = null } = {}) {
  return withDefaultsFile(connection, async (defaultsFile) => {
    const args = [`--defaults-file=${defaultsFile}`, '--batch', '--skip-column-names', '-e', sql];
    if (database) args.push(database);
    const { stdout } = await run('mysql', args);
    return stdout;
  });
}

/** Reads a `--name=value` flag off the command line. */
export function flag(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

/** The tables whose row counts a restore is checked against. */
export const CORE_TABLES = [
  'User',
  'Order',
  'Voucher',
  'AffiliateCommission',
  'WithdrawalRequest',
  'AdminWithdrawal',
  'PartnerSettlement',
  'ActivityLog'
];
