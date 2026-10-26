# Stages 9 to 11: payments, owner pages and operations, hardening

Built together on branch `feat/stages-9-11` (one merge request, CI once, per the Session 27 slim process). No new npm dependency.

## What exists

| Stage | Screen | Data calls (`GET /api/v1/admin/...`) | Operations (`POST /api/v1/admin/...`) |
|---|---|---|---|
| 9 | `/admin/payments` (B9), Payments block on `/admin/analytics` (S9.3), `/admin/analytics/performance` (C3, owner) | `payments`, `payment-leads`, `payments-csv` (a file), `performance-all` (owner); `analytics` now also returns `payments` | `payments.record`, `payments.void` |
| 10 | `/admin/settings` (C4, owner), `/admin/health` (C7, owner) | `settings`, `health` (both owner) | `settings.update` (owner + 2FA check), `export.download` (owner + 2FA check, returns a file) |
| 11 | Enforced CSP, menu entries, flow map | `GET /api/v1/health?deep=1` (admin) | none |

Menu: Content, Analytics and Payments for every admin; Settings and Health for the owner. (The Content and Analytics screens from Stages 6 and 7 had no menu entry; they are added now.)

## Migration 0011 (additive, no table or column changes)

- `placement_payment`: UPDATE granted on `voided_at`, `voided_by`, `void_reason` only; the update policy requires `voided_by` to be the signed-in person; the trigger `placement_payment_guard` refuses an edit of any other column, a second void, a change to a voided row, and a re-link (clearing `lead_id` is allowed, which erasure needs, voided or not).
- `app_record_job(job, ok, detail)`: the daily job records that it ran as an audit row with no actor. Accepts only `rollup` and `usage`.
- `app_usage_snapshot()`: database size, image bytes and the image budget. Sizes only.

## Decisions made without asking (veto any of them)

- **A payment's date is checked in the service, not by a database rule**, as the architecture says (7.6): a database check against the clock would make test data depend on the date. The WAT calendar day is used.
- **Amounts are typed in dollars and cents** (`1,500.50`), turned into integer cents in one function, and refused if zero, negative, more than two decimals, in exponent form or over $100 million.
- **A repeat of the same submission token with different facts is a 409**, not a silent keep of the first.
- **CSV cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'`** (the rule lists four characters; tab and carriage return are added because some spreadsheets strip them and then read a formula). The file has a byte order mark so Excel reads it as UTF-8. More than 5,000 rows is refused with a message to narrow the dates.
- **Settings limits:** weekday SLA 1 to 72 hours, weekend 1 to 168, stale days 30 to 730, freshness 1 to 365 or not set, image budget 100 MiB to 5 GiB. The time zone is shown, not editable. The phone number is cleaned of spaces and dashes and must be E.164.
- **A WhatsApp number change tells the public site to refresh** through the existing revalidate request (area `site`, every public page path). If that request fails the change is still saved and the site catches up within an hour.
- **The page-view switch on Health is the same operation as Settings** (`settings.update`), so it has the same 2FA check and audit row.
- **Health database budget is 0.5 GiB** (the smaller of the two figures Neon's pages have shown). GitHub artifact storage is checked by the backup workflow itself (it fails at 70% of 500 MB), not by the Worker, because reading it needs a token that would have to live in the Worker. Neon compute hours are not read by any code (the Stage 0 probe was never measured); Health links to the console.
- **Full export** is a POST (so the 2FA check, the audit row and the no-cache headers apply). It is built inside Postgres, one JSON text per table, and joined without parsing, to keep Worker CPU low. Four tables are left out on purpose (secrets); a test fails if a new table is neither exported nor listed as excluded.
- **Backups:** `pg_dump --schema=public` only (Neon's own `neon_auth` tables hold sessions and tokens), custom format, piped into `age` encryption to your public key, so no unencrypted copy touches a disk. PostgreSQL 18 client tools (Neon production runs 18; pg_dump refuses a newer server). The monthly images-only artifact stays dropped (D17); `scripts/backup-images.mjs` is its replacement.
- **CSP:** the whole policy is enforced. `script-src` keeps `'unsafe-inline'` because Next.js inlines bootstrap scripts into prerendered pages and a nonce would need a dynamic render of every page (not affordable on the free CPU limit, ADR-033). `img-src` gains `blob:` for the admin image preview. A Playwright test loads every public route with the policy on and fails on any violation.
- **Uptime check** tries three times, a minute apart, before failing; its address is the repository variable `UPTIME_URL` (default: the `workers.dev` address).

## Things only the owner can do or confirm (not done by Claude Code)

1. Create the repository secrets `BACKUP_DATABASE_URL` and `BACKUP_AGE_RECIPIENT`, make the age key pair and store the private key safely (`docs/recovery.md` section 2). Then run **Weekly encrypted database backup** once, and again with `force_failure`, and say if you were told (tracker H22).
2. Run **Hourly uptime check** once against production and once with `force_failure` (H23). Optionally set the variable `UPTIME_URL`.
3. Make a first copy of the pictures with `scripts/backup-images.mjs` (H14).
4. Try `scripts/ops/reset-owner-2fa.sql` on a **throwaway Neon branch** once (it is tested on a local Postgres, not on Neon's own `neon_auth` tables).
5. After the merge, run the deploy workflow once with `cpu_scenarios` = `payments`. Watch Workers Logs for the owner-only calls (`admin/settings`, `admin/health`, `admin/export.download`), which have no measurement scenario.
6. The full pre-launch checklist: `docs/pre-launch-checklist.md`. Stage 11 stays `in-progress` until you sign it off.
7. French text of the new screens is unreviewed by a native speaker.

## Checks run locally (2026-10-26)

Typecheck and lint clean. Unit tests 638 passed (41 files). Integration tests on PGlite: 646 passed, 1 failed: `stage7-analytics > S7.1 ... adds the collector's counts to the daily table, and again on a second run`, which **also fails on the unchanged Stage 6 to 8 code** (checked with the changes stashed) and passed in CI for PR #31; it compares row order and looks like a PGlite ordering difference on this machine. Playwright: the new `stage9-11.spec.ts` 36 passed against a production build. **Not run:** the full Playwright suite after the menu and CSP changes, CI on Postgres 16, the backup self-test (needs `age` and PostgreSQL 17 tools, runs in GitHub), the Worker size gate, any CPU measurement, anything against real Neon.
