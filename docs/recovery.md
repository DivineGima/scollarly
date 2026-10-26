# Recovery procedures (S10.4)

Three things can go wrong that only you can fix. Each has a procedure here, and each was tested (see the last line of its section). Read this once now, so you know where it is on a bad day.

Everything below needs **the database owner connection** (the `neondb_owner` URL from the Neon console) unless it says otherwise. Never paste that URL into a chat, an issue or a file in the repository.

---

## 1. You are locked out of two-factor (lost the phone and every recovery code)

**First, are you really locked out?** After five wrong codes the lock lasts 15 minutes by itself. Wait 15 minutes and try the recovery codes you saved (Security page, "Regenerate recovery codes"). Only go on if the authenticator app is gone **and** the recovery codes are gone.

1. Open the Neon console, your project, **SQL Editor**, branch `production`. Make sure you are connected as the owner role.
2. Open `scripts/ops/reset-owner-2fa.sql` from the repository, copy all of it, paste it in the editor and run it. It is one transaction. It removes your authenticator secret, recovery codes and 2FA checks, ends your sign-in sessions, and writes an audit entry. Your account and the owner role stay.
3. Sign in with Google using the **owner email**. You land on "Set up two-factor" like the first time (C0). Scan the new QR code, save the **new** recovery codes somewhere that is not the same phone.
4. Open **Audit log**: there is a line "Two-factor was reset by the recovery procedure". If you did not run it, treat it as a break-in: change the Google password, regenerate recovery codes, and look at the team list.

Safe to run twice. Tested: `tests/integration/stage10-recovery.test.ts` runs this exact file.

---

## 2. The database is damaged or wiped: restore from the weekly backup

The backup is a GitHub Actions artifact called `scollarly-database-<run>`, kept 28 days, encrypted so that only your private key opens it.

**One-time set-up (do this now, before you need it)**

1. On your own computer install [age](https://github.com/FiloSottile/age) and run `age-keygen -o scollarly-backup-key.txt`. It prints `Public key: age1...`.
2. **Keep `scollarly-backup-key.txt` safe and off GitHub** (a password manager and a USB stick). Without it no backup can be opened. Anyone with it can read the backups.
3. In the repository: Settings, Secrets and variables, Actions, **Repository secrets**, add
   - `BACKUP_AGE_RECIPIENT` = the `age1...` public key,
   - `BACKUP_DATABASE_URL` = a connection string that can read every table past row level security. The owner role's URL works (it bypasses row level security); a narrower read-only role must also have `BYPASSRLS`, or the dump comes out empty.
4. Actions, **Weekly encrypted database backup**, Run workflow, once. Check it goes green and an artifact appears.
5. Run it once more with **force_failure** ticked. It must fail and you must be told (an email from GitHub, or the red cross in the Actions list). If you hear nothing, your GitHub notification settings need fixing. Do this test, then you know the alarm works.

**Restoring**

1. Download the newest artifact from the Actions run page and unzip it.
2. Make a **new Neon branch** of the project (never restore over production by hand). The branch already has the `neon_auth` schema and the `app_runtime` role; if you restore into a fresh project, create the role first (`scripts/ci/ensure-runtime-role.mjs`).
3. With age and the PostgreSQL 18 client tools installed:

   ```
   RESTORE_DATABASE_URL="<connection string of the NEW branch, owner role>" \
     bash scripts/ops/restore-db.sh scollarly-2026-10-25.dump.age scollarly-backup-key.txt
   ```
4. Check the branch: open the Neon SQL editor on it and compare `select count(*) from lead;`, `placement_payment` and `media_asset` with what you expect. Every table must have row level security (`select relname, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'` shows `true` for all).
5. Point the app at the branch: change the `DATABASE_URL` Worker secret to the app_runtime URL of the branch (Cloudflare, Workers, scollarly, Settings, Variables), then open **Health** and sign in as a student, an admin and the owner. If all three work, keep it; promote the branch in Neon or keep using its URL.
6. What a restore does **not** bring back: Neon Auth's own tables (the people who signed in). They are Neon's. Everyone signs in with Google again and lands on the same account because rows are matched by the Google user id; if Neon issued new ids, ask Claude Code to re-link staff in `app_user`.

Tested: `.github/workflows/backup-selftest.yml` dumps, encrypts, restores into an empty database and compares row counts, policies and the payments guard, and it proves that a failing dump fails the script. It runs whenever the backup scripts change.

---

## 3. Pictures are missing or damaged: restore from your own copy

Pictures are **not** in the database or in the weekly backup. They are in Neon Object Storage, named by their own SHA-256 fingerprint, and nothing in the app can delete or change one (decision D17). The manifest of what must exist is the `media_asset` table.

**Keep your own copy (monthly, and after any bulk upload)**

1. Settings, **Download full export**. Save the file.
2. In a terminal in the repository:

   ```
   node scripts/backup-images.mjs --manifest scollarly-export-2026-10-26.json --base-url https://<your bucket address>/images --out D:/scollarly-images
   ```
   The bucket address is the public storage address in the Neon console (Object Storage, bucket `images`). No password is needed.
3. It adds what is missing, checks every file against its fingerprint, replaces a damaged local file, and ends with `RESULT: every picture is on disk and checked.` Anything else is listed with the reason. Exit code 0 means all good.

**If the bucket loses or damages pictures**

1. Run the script above. It names every picture that is `MISSING in the bucket` or `CORRUPT in the bucket`.
2. Put the pictures back from your folder: each file is named `<sha256>.webp`. In the app: Content, Images, upload the same picture again. The upload is stored under the same name, so every page that used it works again. (If you have many, ask Claude Code for a one-off upload script; the store accepts a file only under its own hash.)
3. Run the script again until it ends with the all-good line.

Tested: `tests/unit/stage9-10-pure.test.ts` (manifest reading, a missing object, a corrupt object, a damaged local copy, a network failure, files left alone).

---

## When something is wrong and you are not sure

Open **Health** (owner menu). It shows when the daily jobs last ran, how full the database and pictures are, and links to Neon, Cloudflare and GitHub. The site's own address plus `/api/v1/health` answers `{"status":"ok"}` when the Worker is up; the hourly uptime check calls it and fails (and GitHub tells you) when it is not.
