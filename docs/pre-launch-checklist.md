# Pre-launch checklist (S11.6, PRD 12.2; extended for version 2 in S13.8)

**Only the owner marks an item done.** Claude Code prepared the list and can do the "Claude Code does" part when you send what is asked. Nothing here has been ticked. Where an item has a tracker ID (H or E), the tracker is the record.

## A. Content that must be true before the site is public

| # | Item | You do | Claude Code does | Done by owner (date) |
|---|---|---|---|---|
| E1 | Real figures: students helped and admitted (H4) | Send the confirmed numbers | Enters them as confirmed statistics, publishes | |
| E2 | Testimonials, each with proof of consent (H4) | Send text, person, consent record | Enters them with the consent record; a testimonial without one is never published | |
| E3 | Team bios (H4) | Send confirmed names, roles, bios | Enters and publishes | |
| E4 | Privacy notice and terms; legal check on consent for 17-year-olds and data protection in the seven student countries (H5) | Send the final text | Puts it in `privacy.body` and `terms.body`, changes `CONSENT_NOTICE_VERSION` so each lead records which text it agreed to | |
| E8 | Fees: each marked confirmed with its real range | Confirm per university | Updates the rows. Until then the pages say "Fees to be confirmed" | |
| R5 | Legal check and text for a parent applying for a child, minors, and consent for the lead that onboarding creates automatically (extends E4). Today the consent text is the placeholder `draft-1` (flag F25) | Send the final text | Puts it in the onboarding consent notice and changes the notice version so each lead records which text it agreed to | |
| R6 | Trust content for the landing page (E1 to E3 above): until they are confirmed the landing page shows no statistic, testimonial or bio | Send the confirmed content | Enters and publishes it | |
| R4 | The logo: the image you sent was traced to `public/brand/logo.svg` and the icons were built on `#1F3BFF` (2026-11-04) | Look at the logo in the site header, and the installed icon and launch screen on a real Android phone; say if anything is off | Re-traces or rebuilds with `node scripts/make-icons.mjs` if you want a change | |
| | **Rule:** no unconfirmed statistic, testimonial or team bio is published | Check the public site once | A test fails if one appears (`stage3-public.spec.ts`, S3.4) | |

## B. Numbers and accounts

| # | Item | Notes | Done by owner (date) |
|---|---|---|---|
| H3 | WhatsApp number and the contact number shown on the site | Answered 2026-10-24 (+91 98157 25968). Confirm they are still right; you can change them any time in **Settings** without a deploy | |
| H9 | The remaining "[Mine, confirm]" items (SLA hours 4 and 24, step-up window 10 minutes, invite expiry, backup retention 28 days, hourly uptime check, image caps) | Read them in the PRD and architecture and say "yes" or change them | |
| H10 | Metric targets and the pipeline freshness "N days" | After four weeks of data; **Settings** has the field, **Health** shows the result | |
| H12 | Neon Object Storage limits | The pricing page shows 5 GB and no request or transfer limit | |
| R1 | Publish Google's OAuth app (it is in Testing mode with you as the only test user, flag F22). **Until this is done, real students cannot sign up** | In the Google Cloud console, OAuth consent screen: set the app to In production. Then try Create account with a Google account that is not yours | Nothing; tell Claude Code when it is done | |
| H21 | Google sign-up: a Google account that was not on the test-user list could sign up as a student | Open the OAuth consent screen: Testing or In production? Does Neon Auth use its own shared Google login or your client ID? Decide if sign-ups should be restricted. Publishing the Google app is a launch step | |
| H8/H13 | Google OAuth credentials in Neon Auth | Done 2026-10-24; at launch, move the Google app from Testing to In production | |
| H15 | Magic Link plugin off in Neon Auth | Done 2026-10-24 per the owner | |
| H17 | Real Turnstile widget | Secrets set 2026-10-25. A real widget check from a browser is part of H19 | |
| H19 | Phone test: tap WhatsApp, fill the quick form, confirm the chat opens with the reference and the lead is in the database; repeat in airplane mode | Send Claude Code the reference | |
| H20 | Make the repository private again | Then the Actions minute limit applies; see `docs/quota-review.md` | |
| F13 | Neon Auth keeps visitors' IP and browser string; migration 0004 blanks them | Try on a throwaway branch, then confirm a real sign-in leaves both empty | |
| F8 | `main` is not protected by a branch rule. The repository is public today, so GitHub would allow one; on 2026-11-04 you chose not to change GitHub settings. If H20 makes the repository private again, GitHub Free will refuse the rule | Decide: keep discipline-only (record it as an accepted risk), or turn the rule on while the repository is public | |

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
2. Sign in as each role and open the screens. Tick only what you saw work. The screens are the version 2 tabs (Home, Leads, Content, Insights for staff; Home, Universities, My progress, Help for students) and the round More button:

| Role | Open | Expect | Done by owner (date) |
|---|---|---|---|
| A new person (a Google account with no Scollarly account) | Press **Sign in**, not Create account | A confirm screen "No account found, create one?". Press Back: no account is made. Then press **Create account** | |
| Student | Create account, answer the questions (Basics, School results, Study plan), finish | A reference number; the Home tab greets you by name; **Universities** shows the university offering your course first | |
| Student | Turn the phone to airplane mode and reopen the app | Your name, your courses and the ordered universities still show; changes say they need a connection | |
| Parent | Create account as a parent, give the child's name and your own number | The lead holds the child's name and your number (check in the admin Leads tab) | |
| Student | `/admin`, `/admin/insights` | 404 | |
| Student | **More**, then Notifications | Items about your own application only; **Mark all read** clears the dot | |
| Admin (invite one) | Home, Leads, Content, Insights, and Notifications from More | Everything opens; no Team, Audit log, Security, Settings or Health in More; the first-visit tour shows once per tab and never again | |
| Admin | `/admin/settings`, `/admin/health` | 404 or an empty page | |
| Admin | An old bookmark such as `/admin/payments` | It moves to the Insights tab, payments section | |
| Admin | Record a payment, then void it with a reason | Totals change; the voided row is struck through; CSV downloads | |
| Owner (with the authenticator code) | Team, Audit log, Security, **Settings**, **Health** from More, and every admin's performance in Insights | All open; saving Settings asks for the code | |
| Owner | Settings: change the WhatsApp number to your own, save, open the public Contact page and the landing page's course finder | The new number within about 30 seconds, no deploy. Put the real one back | |
| Owner | Settings: Download full export | A JSON file with no secrets and no pictures; it includes onboarding profiles | |
| Anyone, on a real Android phone | Install the app from the browser menu | The installed icon and the launch screen use the white logo on dark neon blue (needs R4 done first) | |

3. Tell Claude Code "the smoke test passed for student, parent, admin and owner" and it records it in the tracker. It does not record it on its own.

## E2. The watched test (S13.9)

Three real people use the live app with **no help from you**: one student, one parent, and one admin (or the first person you will invite). Watch without speaking and note the first place each got lost. Send the notes to Claude Code, who records them in `tracker/tracker_2.md` (the "Watched test log" table). This needs R1 to be done, because the student and the parent need a Google account that can sign up. Claude Code cannot run this step.

## E3. Version 3 checks (S14.8)

Try these on the live site, on a phone, signed out and then signed in:

- [ ] Signed out: the public pages open and offer **Create an account** (version 4 removed the Apply and WhatsApp buttons and the sign-in pop-up from the public pages; see E4). No chat opens.
- [ ] Create an account with an email and a password (8 characters or more). You land on the questionnaire, not on a dashboard. The last button says **Sign up**. After it you land on the app.
- [ ] Sign out and sign in again with the same email and password. Wrong password: one plain sentence.
- [ ] Sign in with Google too (the same checks).
- [ ] **Staff sign in with Google only.** Do not give a staff member (or yourself) a password login. If a staff member is locked out, remove their password account in the Neon console (F30).
- [ ] Campus tours page: each university with a video shows a preview picture; tapping it plays the video. Karnataka has no tour and is not listed. Nothing says "available on request".
- [ ] No fee, fee range or "to be confirmed" text anywhere; the footer does not say "Free for students"; links have no underline except inside running text.
- [ ] Privacy and Terms are complete and name Scollarly with gimafolabit@gmail.com (owner action R5: have them reviewed by a lawyer before launch).
- [ ] Admin, Insights, Overview: the tiles, the five charts and the filters work; Download as CSV opens in a spreadsheet and has no names, numbers or emails.
- [ ] Admin, Leads, Pipeline: move a lead to another step; it moves and the list shows the new step.
- [ ] Google console (owner action R1): publish the OAuth app so people other than you can sign in with Google, and paste the Privacy and Terms addresses there.

## E4. Version 4 checks (S15.7)

Try these on the live site, on a phone:

- [ ] Signed out: every public page offers **Create an account** and **Sign in**. There is no Apply form, no WhatsApp form and no chat link. The Contact page shows the number as text with a Copy button.
- [ ] Create a new account and finish the profile. The last screen asks **Apply now / Not yet**. "Not yet" lands on the dashboard; no application exists yet (the Home shows an Apply button).
- [ ] Apply with three programmes. You see your reference. Open the Apply screen again (or an old `/apply` link): it says you already applied and shows the reference and stage. Try it from a second phone too: same answer.
- [ ] Turn the phone offline, apply, then turn it back on: the application is sent once.
- [ ] Back on a public page, the header says **My account** (not Sign in), and it opens your home. Sign out: it says Sign in again. Open `/sign-in` while signed in: you are sent to your home.
- [ ] In the app, the Home, My progress and Help each open WhatsApp with a message; the chat creates no application.
- [ ] Admin, Leads, **Not applied yet**: students who finished their profile and did not apply, newest first, with a Message on WhatsApp link. The Leads list and its counts do not change when a student onboards.
- [ ] Admin, Insights, Overview: the **Finished their profile** tile, **Applied, of those**, and the funnel's first step. With a Source or Assigned filter set, those two tiles are hidden (a profile has neither).
- [ ] Owner action: run the **Stage 0 deploy and measure** workflow once with the CPU measurement on and send the table to Claude Code, which records the Stage 15 rows in `tracker/tracker_4.md`.

## F. Sign-off (H11)

When A to E are done: write "I sign off the pre-launch checklist" to Claude Code, with the date. It records your words in the tracker (H11). Until then Stage 11 stays `in-progress`.
