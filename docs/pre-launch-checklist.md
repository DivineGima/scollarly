# Pre-launch checklist (S11.6, PRD 12.2)

**Only the owner marks an item done.** Claude Code prepared the list and can do the "Claude Code does" part when you send what is asked. Nothing here has been ticked. Where an item has a tracker ID (H or E), the tracker is the record.

## A. Content that must be true before the site is public

| # | Item | You do | Claude Code does | Done by owner (date) |
|---|---|---|---|---|
| E1 | Real figures: students helped and admitted (H4) | Send the confirmed numbers | Enters them as confirmed statistics, publishes | |
| E2 | Testimonials, each with proof of consent (H4) | Send text, person, consent record | Enters them with the consent record; a testimonial without one is never published | |
| E3 | Team bios (H4) | Send confirmed names, roles, bios | Enters and publishes | |
| E4 | Privacy notice and terms; legal check on consent for 17-year-olds and data protection in the seven student countries (H5) | Send the final text | Puts it in `privacy.body` and `terms.body`, changes `CONSENT_NOTICE_VERSION` so each lead records which text it agreed to | |
| E8 | Fees: each marked confirmed with its real range | Confirm per university | Updates the rows. Until then the pages say "Fees to be confirmed" | |
| | **Rule:** no unconfirmed statistic, testimonial or team bio is published | Check the public site once | A test fails if one appears (`stage3-public.spec.ts`, S3.4) | |

## B. Numbers and accounts

| # | Item | Notes | Done by owner (date) |
|---|---|---|---|
| H3 | WhatsApp number and the contact number shown on the site | Answered 2026-10-24 (+91 98157 25968). Confirm they are still right; you can change them any time in **Settings** without a deploy | |
| H9 | The remaining "[Mine, confirm]" items (SLA hours 4 and 24, step-up window 10 minutes, invite expiry, backup retention 28 days, hourly uptime check, image caps) | Read them in the PRD and architecture and say "yes" or change them | |
| H10 | Metric targets and the pipeline freshness "N days" | After four weeks of data; **Settings** has the field, **Health** shows the result | |
| H12 | Neon Object Storage limits | The pricing page shows 5 GB and no request or transfer limit | |
| H21 | Google sign-up: a Google account that was not on the test-user list could sign up as a student | Open the OAuth consent screen: Testing or In production? Does Neon Auth use its own shared Google login or your client ID? Decide if sign-ups should be restricted. Publishing the Google app is a launch step | |
| H8/H13 | Google OAuth credentials in Neon Auth | Done 2026-10-24; at launch, move the Google app from Testing to In production | |
| H15 | Magic Link plugin off in Neon Auth | Done 2026-10-24 per the owner | |
| H17 | Real Turnstile widget | Secrets set 2026-10-25. A real widget check from a browser is part of H19 | |
| H19 | Phone test: tap WhatsApp, fill the quick form, confirm the chat opens with the reference and the lead is in the database; repeat in airplane mode | Send Claude Code the reference | |
| H20 | Make the repository private again | Then the Actions minute limit applies; see `docs/quota-review.md` | |
| F13 | Neon Auth keeps visitors' IP and browser string; migration 0004 blanks them | Try on a throwaway branch, then confirm a real sign-in leaves both empty | |
| F8 | `main` is not protected (GitHub Free private repository) | Make the repository public, upgrade, or accept discipline-only and record it | |

## C. The domain (F10, H7, E7)

`scollarly.co.in` is locked at GoDaddy (.IN KYC for a foreign national). Launch can run on the `workers.dev` address. If you move to the domain: add it to Cloudflare, point the Worker at it, add the redirect address in Google and Neon Auth trusted domains, set the repository variable `UPTIME_URL` to the new address, and run `node scripts/smoke.mjs <new address>`.

## D. Operations you must have done once (S10, S11.8)

| Item | How | Done by owner (date) |
|---|---|---|
| Backup secrets set (`BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`) and the private key stored safely | `docs/recovery.md`, section 2 | |
| Weekly backup ran green once | Actions, Weekly encrypted database backup, Run workflow | |
| Backup alarm tested: run it with **force_failure** and confirm you were told | Same page | |
| Uptime check ran green once against production | Actions, Hourly uptime check, Run workflow | |
| Uptime alarm tested with **force_failure** | Same page | |
| First image copy made to your own disk with `scripts/backup-images.mjs` (H14) | `docs/recovery.md`, section 3 | |
| Read `docs/recovery.md` once, including the 2FA lockout steps | | |
| Monthly habit: open the Actions page and confirm no workflow is shown as disabled (a public repository loses scheduled runs after 60 days without a commit) | `docs/recovery.md`, section 2, step 6 | |

## E. Production smoke test (S11.7)

1. `node scripts/smoke.mjs https://scollarly.gimafolabit.workers.dev` (or the domain). Every line must say PASS. It checks the public pages, the headers, and that nothing signed-in is open to a visitor. Claude Code can run it for you.
2. Sign in as each role and open the screens. Tick only what you saw work:

| Role | Open | Expect | Done by owner (date) |
|---|---|---|---|
| Student (a Google account that is not staff) | `/me`, `/me/link-application`, `/me/profile`, `/me/data` | Progress or "We are matching your application"; export downloads; **do not press Erase on a real account** | |
| Student | `/admin`, `/admin/payments` | 404 | |
| Admin (invite one) | Overview, Leads, Content, Analytics, Payments, Data requests, Profile | Everything opens; no Team, Audit, Security, Settings, Health in the menu | |
| Admin | `/admin/settings`, `/admin/health`, `/admin/analytics/performance` | 404 or an empty page | |
| Admin | Record a payment, then void it with a reason | Totals change; the voided row is struck through; CSV downloads | |
| Owner (with the authenticator code) | Team, Audit log, Security, **Settings**, **Health**, every-admin performance | All open; saving Settings asks for the code | |
| Owner | Settings: change the WhatsApp number to your own, save, open the public Contact page | The new number within about 30 seconds, no deploy. Put the real one back | |
| Owner | Settings: Download full export | A JSON file with no secrets and no pictures | |

3. Tell Claude Code "the smoke test passed for student, admin and owner" and it records it in the tracker. It does not record it on its own.

## F. Sign-off (H11)

When A to E are done: write "I sign off the pre-launch checklist" to Claude Code, with the date. It records your words in the tracker (H11). Until then Stage 11 stays `in-progress`.
