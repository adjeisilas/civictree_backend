# CivicTree backend — operations runbook

Everything needed to release a change, take and prove a backup, and recover
when something goes wrong. Keep it next to the code; it goes stale otherwise.

---

## 1. Environment variables

Nothing here belongs in git — set them on the host or in the deployment
platform's secret store.

### Required — the server will not start without these

| Variable | What it is |
|---|---|
| `DATABASE_URL` | `mysql://user:pass@host:3306/dbname` |
| `JWT_ACCESS_SECRET` | Signs access tokens. Rejected if under 32 characters or it looks like a placeholder. |
| `JWT_REFRESH_SECRET` | Signs refresh tokens. Must be **different** from the access secret. |

Generate either with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Set these too — they work unset, and that is the problem

Each of the four falls back to a key derived from a JWT secret. The derived keys
are strong, so nothing is insecure, but it ties unrelated things together:
rotating one JWT secret then breaks data that has nothing to do with sessions.
The server logs a warning naming each one at startup in production.

| Variable | Derived from | What rotating that secret would break |
|---|---|---|
| `SECRET_ENC_KEY` | `JWT_REFRESH_SECRET` | Voucher PINs and authenticator secrets become unreadable |
| `OTP_SECRET` | `JWT_REFRESH_SECRET` | Password-reset codes already sent stop verifying |
| `RECOVERY_CODE_SECRET` | `JWT_REFRESH_SECRET` | Two-factor recovery codes stop working |
| `USSD_STATE_SECRET` | `JWT_ACCESS_SECRET` | USSD sessions in progress are dropped |

`SECRET_ENC_KEY` must be exactly 64 hex characters (32 bytes); the others are
free-form. `NODE_ENV` should be `production` on the server — several protections
only switch on there.

> **`SECRET_ENC_KEY` cannot be rotated casually.** Anything encrypted with the
> old key becomes unreadable. Rotating means decrypting with the old key and
> re-encrypting with the new one in one pass — see `scripts/encrypt_voucher_pins.js`
> for the shape of that job.

### Required for the features that use them

| Variable | Used by |
|---|---|
| `HUBTEL_PAYMENT_API_ID`, `HUBTEL_PAYMENT_API_KEY` | Checkout, status checks, payouts |
| `HUBTEL_PAYMENT_MERCHANT_ACCOUNT_NUMBER` | Collections |
| `HUBTEL_PAYMENT_DISBURSEMENT_ACCOUNT_NUMBER` | Affiliate and admin payouts |
| `HUBTEL_CALLBACK_TOKEN` | Shared secret on callback URLs |
| `HUBTEL_CALLBACK_IPS` | Comma-separated allow-list for callback sources |
| `HUBTEL_SMS_CLIENT_ID`, `HUBTEL_SMS_CLIENT_SECRET`, `HUBTEL_SMS_SENDER_ID` | Voucher delivery and reset codes |
| `API_URL`, `FRONTEND_URL` | Callback and redirect URLs |
| `CORS_ORIGINS` | Comma-separated list of browser origins allowed to call the API |
| `CLOUDINARY_*` | Timetable file uploads |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web push (`npm run generate-vapid`) |
| `EMAIL_USER` | The VAPID contact address. **Web push is disabled without it** — it previously fell back to a hardcoded personal inbox, which has been removed. |

### Optional, with defaults

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5000` | |
| `NODE_ENV` | `development` | Set to `production` on the server |
| `TRUST_PROXY` | off | Set when behind nginx or a load balancer, or rate limits key on the proxy's IP |
| `HUBTEL_IP_CHECK` | on | `off` **only** for local development |
| `ENABLE_API_DOCS` | off | Keep Swagger off in production |
| `LOG_LEVEL` | `info` | |
| `ACCESS_TOKEN_TTL` | see `utils/jwt/jwt.js` | |
| `MAX_VOUCHERS_PER_ORDER` | see `utils/order/orderHelpers.js` | |
| `PAYOUT_ALERT_THRESHOLD_GHS` | see `utils/cron/securityMonitor.js` | Payout spike alert threshold |
| `VERIFY_DATABASE_URL` | falls back to `DATABASE_URL` | Privileged user for restore drills |

---

## 2. Releasing a change

Run these in order. Steps 1 and 2 are not optional — a migration that goes
wrong without a backup is unrecoverable.

```bash
# 1. Back up, and prove the backup is good
npm run db:backup
npm run db:verify-backup

# 2. Check what the migration will do before it does it
npm run db:status

# 3. Deploy the code, then apply migrations
npm run db:deploy          # prisma migrate deploy — never `db push` in production

# 4. Restart the app, then smoke-check
curl -fsS https://api.civictreegh.com/api/health
```

`/api/health` round-trips to the database and answers 200 when it is reachable,
503 when it is not — so a load balancer pulls a broken instance out of rotation
on its own. It sits ahead of the rate limiter, so polling it every few seconds
is fine.

### Smoke checks after every release

- [ ] An admin can sign in, and two-factor is still demanded where it was before
- [ ] `GET /api/admin/dashboard` returns figures, not an error
- [ ] A web checkout reaches Hubtel's payment page
- [ ] The USSD menu answers and reaches the confirmation step
- [ ] A test SMS arrives
- [ ] `tail` the logs for the first five minutes; the cron jobs log on startup

### Rolling back

Code rolls back by redeploying the previous image. **Migrations do not.**
`prisma migrate deploy` has no down-step, so a bad migration is undone by
restoring the backup from step 1:

```bash
node scripts/restore_database.js --file=backups/<the dump from step 1> --i-know
```

This is why the backup comes first.

---

## 3. Changing the schema

This project is on `prisma migrate` as of the `0_init` migration, which was
baselined against the schema already in production.

```bash
# Local: edit prisma/schema.prisma, then
npm run db:migrate            # creates prisma/migrations/<timestamp>_<name>/

# Commit the generated migration.sql. Review it — Prisma will happily
# generate a DROP COLUMN that silently discards data.

# Production: applied by the release steps above
npm run db:deploy
```

### Generating a migration on Windows

`prisma migrate diff` reads the database it is pointed at, and MySQL on Windows
lowercases table names. A migration generated here therefore comes out as:

```sql
ALTER TABLE `order` ...      -- fails on Linux
ALTER TABLE `Order` ...      -- what 0_init actually created
```

which fails on the Linux server. The CTVET/NABTEX migration hit exactly this and
had to be rewritten in schema case.

So: after generating a migration on Windows, check the table names against
`prisma/schema.prisma` and fix the casing. CI applies every migration to an
empty MySQL on Linux, which is what catches it — do not skip that signal.

**Never run `prisma db push` against production.** It diffs and applies without
a migration file, so there is no record of what changed and no way to replay it
on another environment. `npm run db:push` is kept only for throwaway databases.

CI applies `prisma/migrations` to an empty database on every run, so a broken or
missing migration fails there rather than during a release.

---

## 4. Backups

### What the scripts do

| Command | Effect |
|---|---|
| `npm run db:backup` | Consistent gzipped dump into `./backups`, prunes dumps older than 30 days |
| `npm run db:verify-backup` | Restores the newest dump into a scratch database, compares row counts, drops it |
| `npm run db:restore -- --file=<dump> --into=<new_db>` | Restores beside the live data |
| `npm run db:restore -- --file=<dump> --i-know` | Overwrites the live database |

The dump uses `--single-transaction`, so it is a snapshot of one moment and does
not lock the tables. It is safe to run against a live database.

### Scheduling it on the server

```cron
# Nightly at 01:30 Accra time, keeping 30 days
30 1 * * *  cd /srv/civictree_backend && /usr/bin/npm run db:backup >> /var/log/civictree-backup.log 2>&1

# Weekly restore drill, Sunday 02:30 — fails loudly if a backup is not restorable
30 2 * * 0  cd /srv/civictree_backend && /usr/bin/npm run db:verify-backup >> /var/log/civictree-backup.log 2>&1
```

### Drill result, 2026-10-05

The whole cycle was exercised against a throwaway MySQL 8.0 with a seeded
database (1 user, 25 vouchers):

| Step | Result |
|---|---|
| `migrate deploy` from empty | `0_init` applied, 24 tables, 21 foreign keys |
| `db:backup` | 5.5 KB dump written |
| `db:verify-backup` | Restored into a scratch database, all 8 row counts matched |
| `DELETE FROM Voucher; DROP TABLE ActivityLog;` | Simulated data loss |
| `db:restore --i-know` | 25 vouchers back, dropped table recreated |
| After the restore | Prisma reads it, 21 foreign keys intact, `migrate status` says up to date |

That last row matters: `_prisma_migrations` is inside the dump, so a restore does
not leave the migration history thinking `0_init` still needs applying.

### Two things the scripts cannot do for you

1. **Copy the dumps off the machine.** A backup on the same disk as the database
   does not survive the failure that matters. Sync `./backups` to object storage
   or another host after each run. `backups/` is excluded from git and from the
   Docker image.
2. **Encrypt them.** A dump contains every customer phone number, order and
   password hash. Encrypt at rest wherever they land.

### Restore drill credentials

The application's database user is scoped to one database and cannot create
another — correct, and worth keeping. Give the drill its own credential:

```bash
VERIFY_DATABASE_URL='mysql://backup_verifier:…@127.0.0.1:3306/civictree' npm run db:verify-backup
```

Or grant the app user rights on that one scratch name. `verify_backup.js` prints
the exact statement when it is denied.

### A caveat about dumps across platforms

MySQL on Windows lowercases table names; MySQL on Linux does not. A dump taken
from a Windows development database writes `user`, while Prisma's schema expects
`User`, so **that dump will not work on a Linux server** (and vice versa).
Production dumps come from the production host, so this only bites when someone
tries to seed a server from a developer's laptop.

---

## 4a. The USSD menu

Numbers are derived from the voucher types in
`utils/voucher/voucherTypes.js`: buying occupies 1..N and the fixed options
follow. Adding CTVET/NABTEX in October 2026 therefore moved them:

| Option | Before | Now |
|---|---|---|
| 1 | Buy BECE | Buy BECE |
| 2 | Buy WASSCE/NOVDEC | Buy WASSCE/NOVDEC |
| 3 | Transactions | **Buy CTVET/NABTEX** |
| 4 | Release Dates | Transactions |
| 5 | Support | Release Dates |
| 6 | — | Support |

**Anything that tells customers which number to press needs updating** —
printed material, posters, SMS templates, the website walkthrough (that one is
generated from the shared list, so it is already correct) and any support
script.

The screen is 152 characters with three types, against Hubtel's limit of roughly
160. A fourth type, or a long affiliate business name in the header, will
overflow and need the lines shortened.

## 4b. Clearing the SMS contact list

Admin -> SMS -> Clear Contacts. One button per voucher type plus one for all of
them, each showing its current contact count and when it was last cleared.

There is no contact table. Recipients are derived from two sources, and the
clearance treats them differently:

| Source | What a clearance does |
|---|---|
| `UssdDialer` | **Deleted.** `UssdDialer` is unique on (phoneNumber, voucherType) and the tracker only inserts when no row exists, so the row has to go for a returning caller to register again. |
| `Order.phoneNumber` | **Kept.** Orders are revenue records. A cut-off is recorded in `SmsContactClearance` instead, and those contacts rejoin campaigns when that customer next orders. |

So the count drops to zero and fills up again, with the books untouched. Every
clearance is logged (`SMS_CONTACTS_CLEARED`) with before/after counts, notifies
the other admins, and records who did it.

Clearing one product needs a single confirmation; clearing everything requires
typing `ALL`. A per-type clearance also removes those contacts from the general
campaign, so clearing BECE does not leave BECE buyers reachable via `ALL`.

```bash
# What the buttons call
GET    /api/admin/sms/contacts                       # counts per type
DELETE /api/admin/sms/contacts?voucherType=BECE      # one product
DELETE /api/admin/sms/contacts                       # everything
```

## 5. Monitoring

Scheduled jobs, all in `Africa/Accra` and started by `utils/cron/cronJobs.js`:

| Schedule | Job | Watches for |
|---|---|---|
| `*/5 * * * *` | `reconcilePendingPayments` | Payments Hubtel confirmed after the callback was missed |
| `*/5 * * * *` | `resendFailedVoucherDeliveries` | Vouchers paid for but not delivered |
| `*/10 * * * *` | `reconcileInFlightPayouts` | Payouts left in limbo by a missed callback |
| `0 * * * *` | `checkVoucherStock` | Stock below the configured floor |
| `15 * * * *` | `runSecurityChecks` | Forged callbacks, payout spikes, failed-login bursts |

`runSecurityChecks` is the one that pages a human. Confirm its alerts actually
reach someone — an alert nobody receives is the same as no alert.

### Worth looking at weekly

- Orders paid but undelivered for over an hour
- Payouts stuck in a pending state
- Rejected callbacks (a run of them means either an attack or a Hubtel IP change)
- Failed logins per account, and accounts hitting the lockout

```bash
npm run audit:orders          # reconciles orders against Hubtel's view
```

---

## 6. When something goes wrong

### A payment looks wrong

Hubtel's status API is the only authority, never the callback body.

```bash
node scripts/check_payout_status.js <transaction ref>
npm run audit:orders
```

Order status in the database only moves on a `Paid` from the status API. If an
order is `Paid` without a matching Hubtel record, treat it as an incident and
check the callback logs for that reference.

### A secret leaked

1. Rotate it at the provider first (Hubtel keys in their dashboard).
2. Update the host's environment and restart.
3. JWT secrets: rotating signs every existing session out. That is the point.
4. `SECRET_ENC_KEY`: see the warning in section 1 — re-encrypt, do not just swap.
5. Run `gitleaks detect` over the full history, not just the current tree.

### Nobody can sign in as an admin

The self-service reset goes by SMS only (email delivery is off), so it needs a
phone number on the account and working Hubtel SMS credentials. **Put a phone
number on every admin account** — it is the difference between a self-service
reset and the database surgery below.

When that is not available, set the password directly. It must be a bcrypt hash
at cost factor 12: write plain text into that column and the sign-in fails with
"invalid credentials" and no clue why.

```bash
# 1. On the server, generate the hash (quote the password so the shell leaves it alone)
node -e "require('bcryptjs').hash('the-new-password',12).then(console.log)"
```

```sql
-- 2. Set it, and clear the lockout that would otherwise still block the sign-in
UPDATE `User`
   SET password = '<the $2b$12$... hash from step 1>',
       failedLoginAttempts = 0,
       lockedUntil = NULL,
       firstTimeLogin = 0
 WHERE email = '…' AND role = 'ADMIN';
```

Forgotten which address the account uses:

```sql
SELECT email, fullName, isActive, twoFactorEnabled, failedLoginAttempts, lockedUntil
  FROM `User` WHERE role = 'ADMIN';
```

Two things to know about doing it this way:

- **It leaves no audit trail.** Nothing records that an admin password was
  changed outside the application, so a recovery nobody authorised is invisible
  afterwards. Check the password is changed again from inside the app once the
  person is back in.
- **Shell or database access to the server is equivalent to admin access to the
  platform.** That is inherent — anyone who can write to the `User` table can do
  this. Grant it accordingly.

### An admin is locked out but knows their password

Lockout is deliberate after repeated failures, and expires on its own. To clear
it immediately:

```sql
UPDATE `User` SET failedLoginAttempts = 0, lockedUntil = NULL WHERE email = '…';
```

Lost their authenticator: they use a recovery code. Out of recovery codes, use
`--disable-2fa` above, or by hand — and confirm who you are talking to first,
because this removes a factor:

```sql
UPDATE `User` SET twoFactorEnabled = 0, twoFactorSecret = NULL WHERE email = '…';
DELETE FROM `TwoFactorRecoveryCode` WHERE userId = (SELECT id FROM `User` WHERE email = '…');
```

### Vouchers are overselling

Allocation claims rows conditionally inside a transaction, so two orders cannot
take the same voucher. If counts still look wrong, compare `Voucher` statuses
against `Order` rows before issuing refunds:

```bash
npm run audit:orders
```

---

## 7. Known gaps

Open items, so nobody assumes they are handled:

- **Email delivery is off.** Password resets go by SMS only. `EMAIL_*` and
  `GMAIL_*` are unset; the partner notification emails do not send.
- **The partner portal is disabled.** Its routes and the daily settlement cron
  are commented out in `utils/cron/cronJobs.js`.
- **Backups are local-only until someone wires up the offsite copy** (section 4).
  The scripts work — see the drill result — but nothing copies the dumps off the
  machine, which is the half that survives a disk failure.
- **Alert delivery is unconfirmed.** `runSecurityChecks` finds problems; whether
  its output reaches a person has not been tested end to end.
- **No staging environment.** Migrations are first applied for real in
  production. CI applying them to an empty database is a weaker substitute.
- **The restore drill needs its own credential on each host.** The application's
  database user cannot create the scratch database, by design. Until
  `VERIFY_DATABASE_URL` or the one grant is in place, `db:verify-backup` will
  refuse on that host — it prints the statement to run.
- **Eight admin and affiliate forms have not been exercised in a browser** since
  they were changed from copying server data into state to deriving it. Types,
  lint and the build pass; the behaviour is unverified. They are the payout
  details form (affiliate withdrawals and profile), affiliate commission config,
  result release dates, partner settings, and the timetable editor.
