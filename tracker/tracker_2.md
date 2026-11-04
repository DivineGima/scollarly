# Tracker 2: Scollarly v2 refactor

Maintained by Claude Code. Human actions (legal review, DNS, OAuth credentials, vendor terms, owner sign-off) are recorded here only when the owner says they are done.

This tracker starts the refactor (PRD_2, architecture 2, essentials 2). It does not copy the 184 KB session log of `tracker_1.md`; that file is the history of Stages 0 to 12 and stays in the repository. Where a row below says "see tracker_1", the full text and the evidence are there.

## Current position

| Item | Value |
|---|---|
| Current PRD | `PRD_2.md` (2026-10-31) |
| Current architecture | `system_architecture_2.md` (2026-10-31, derived from `PRD_2.md`) |
| Essentials file for the next stage | `essentials/system_architecture_essential_2.md` (Stage 13, one stage) |
| Approved design document | `docs/designs/scollarly-v2-refactor.md` (approved by the owner 2026-10-31; spec review not run) |
| Phase | Stages 0 to 9 and 12 of version 1 are complete and live (see tracker_1). Stages 10 and 11 are `in-progress` in tracker_1 and their three open modules are carried into S13.8. **S13.1 to S13.6 of the refactor are merged. Migrations 0013, 0014 and 0015 are deployed to production as of this session's deploy run.** |
| Next stage | **Stage 13 (the refactor).** S13.1 to S13.6 are complete and merged (PR #46, #48, #49, #50, #51, #52). **S13.7, S13.8 and S13.9 are `in-progress` (Sessions 49 and 50, 2026-11-04):** the landing page, course finder, logo, icon set and manifest, the CPU scenarios, the checklist and quota review, the traceability map and the QA sweep are built; the real-phone icon check, the watched test and the owner's sign-offs are human actions, and each module closes when its pull request is green in CI. |
| Blocked by | Nothing blocks the code. R1 (publish Google's OAuth app) blocks the first real onboarding and the watched test. |

## Standing owner check-ins (ask the owner at the start of every session)

Claude Code: after reading this tracker, ask the owner each open check-in below and show its link. Stop asking only when the owner says the item is done or no longer wanted, and record that here.

| # | Check | Link | Why | Status |
|---|---|---|---|---|
| C1 | Has Neon Auth shipped authenticator-app 2FA (MFA/TOTP)? | https://neon.com/docs/auth/roadmap | Neon Auth had none on 2026-10-24, so the owner's 2FA is our own code on the otpauth library (ADR-037). If Neon ships it, the owner decides whether to replace our code. | **Paused by the owner (2026-10-24): "not yet, it won't come for about a month, stop over-asking".** Do not ask again until about 2026-11-24. Carried unchanged from tracker_1. |

## Start-of-task check results for this version (CLAUDE.md steps 1 to 7)

| Step | Result (2026-10-31) |
|---|---|
| 2 essentials file | `system_architecture_essential_2.md` exists and matches the pattern |
| 3 architecture version | highest `system_architecture_N.md` in `/system_architecture/` is 2 |
| 4 essentials vs architecture | essentials 2 cites `system_architecture_2.md`: match, no intervening version |
| 5 PRD version | highest `PRD_N.md` is 2 |
| 6 architecture vs PRD | architecture 2 says `Derived From: PRD_2.md`: match, no intervening version |
| Version alignment | PRD 2, architecture 2, essentials 2: same N. Each file cites its own N. |

## Session log

### 2026-10-31: Session 40 (office hours and the four version 2 source files, no code written)

**Built against:** essentials `system_architecture_essential_2.md`, architecture `system_architecture_2.md`, PRD `PRD_2.md`, all version 2 (written in this session). Branch `docs/refactor-v2-source-files`. No module of Stage 13 has started.

**Asked by the owner:** a major refactor of the live app, starting with the /office-hours skill, then new `_2` versions of the PRD, architecture, essentials and tracker, with essentials 2 holding one stage. Seven features (simpler admin and owner experience, landing page, clear sign in versus sign up, student and parent onboarding, an iPhone-style menu bar, CRM dashboards, notifications) plus personalisation after onboarding. Five reference images were given as samples of layout only.

**Office hours (what was decided, all by the owner):** see the table in the design document. In short: `/` is redesigned as the landing page with a course finder; Sign in and Create account are separate buttons with a confirm screen; a parent is a student-role account (no fourth role); the questionnaire covers Basics, School results and Study plan; finishing onboarding creates a lead; universities offering the chosen course come first, then best NAAC grade; admin and owner tabs are Home, Leads, Content, Insights and student tabs are Home, Universities, My progress, Help, with a round More button holding Notifications and the other pages; light blue, black and white only; notifications are in-app and derived, with a WhatsApp nudge by hand; page help is a purpose line, helpful empty screens and a first-visit tour; offline shows the student's last copy and the staff's last totals only; the logo is traced to a vector and used white on dark neon blue for the icon and splash.

**Evidence recorded honestly:** only the owner uses the app today. The one concrete pain given was "I got lost finding things". The features are bets from the owner's own use and are tested with real people at the end of the stage (S13.9). A second opinion (a Claude subagent without repository access) was run; its useful points were adopted (derived notifications, no pre-check on sign-in, one idempotent onboarding write, `relationship` stored from day one) and its suggestion to cut the parent flow, charts and tours was not adopted because the owner asked for them in the one stage.

**Written:** `PRD_2.md`, `system_architecture_2.md` (new section 21 and ADR-041 to ADR-050), `system_architecture_essential_2.md` (Stage 13, S13.1 to S13.9), this tracker, and `docs/designs/scollarly-v2-refactor.md` with an addendum.

**Found while writing (flagged, nothing decided silently):** (1) the session function creates the `app_user` row at the first request, so "no row until confirm" became "no confirmed account until confirm" (ADR-042); (2) `programme.field` and `level` already exist, so no new columns; (3) `notifications_seen_at` lives on `app_user`; (4) the student device copy now holds a first name; (5) `CLAUDE.md` Step 2 would point at essentials 1 while its Stages 10 and 11 stay open (flag F21).

**Not done:** no code, no migration, no deploy. The gstack upgrade offered at the start of the session was blocked by the permission classifier and not run. The spec review loop of the office-hours skill was not run.

### 2026-10-31: Session 41 (Stage 13, module S13.1 foundations)

**Built against:** essentials `system_architecture_essential_2.md`, architecture `system_architecture_2.md`, PRD `PRD_2.md`, all version 2 (N = 2 everywhere; the owner's yes on F21 is the basis for starting from essentials 2). Branch `feat/s13-1-foundations`. Module S13.1 only.

**Owner answers recorded:** all five decisions yes (F21 carry-over, the five confirmation points, the course list with M.Tech under "Engineering (postgraduate)", Stage 13 numbering, the neon blue hex); NAAC grades left "not stated"; the owner account is unchanged. PR #45 was merged by the owner.

**Built:** migration `0013_refactor_v2.sql` (`app_user.account_confirmed_at` with backfill, `notifications_seen_at`, `tours_seen`; `student_profile` with row level security forced; the lead checks widened for `onboarding`; `app_resolve_session_v2`, `app_confirm_account`, `app_mark_notifications_seen`, `app_mark_tour_seen`; a trigger that confirms an account on promotion; the erasure function also deletes the profile). `Actor.accountConfirmed` and the `account` area in the Worker's signed-in routing (no refusal of unconfirmed users yet: that is S13.2). `src/lib/courses.ts` (course list and the mapping from programme names), filled into `programme.field` and `level` by the seed (a second run reports zero). `src/modules/nav/config.ts` and `src/components/shell/` (tab bar, More sheet, page intro, empty state, first-visit tour, icons, CSS). The legacy redirect map (built, tested, not wired until S13.6). English and French strings for the shell and the courses. `/account` is never cached by the service worker.

**Tests:** 57 new unit tests, 20 new integration tests; the RLS matrix gained `student_profile`. Whole unit suite 708 of 708; related integration suites (RLS matrix, seed, auth, student, leads, repositories) 218 of 218 on in-process Postgres; `tsc --noEmit` and `eslint` clean. **Migration check on Neon:** applied to a throwaway branch (`test-s13-1-migration`, created from production on 2026-10-31) with the Neon tools: 28 statements, no error; the 4 existing users all became confirmed at their creation time; the 3 leads were untouched; row level security forced on `student_profile` with 3 policies; the runtime role can run the new functions, `PUBLIC` cannot, and nobody can delete a profile. The branch role cannot impersonate `app_runtime` on Neon, so the role-level behaviour was proven by the in-process tests only.

**Found:** the owner-only pages today are Team, Audit, Security, Settings and Health, so an admin's More sheet is only Notifications, Profile and Sign out (PRD_2, architecture 21.4 and 21.17 corrected). Signed-in tabs are full page loads of cached shells (ADR-040), not client navigations (architecture 21.10 corrected). The `{contact_name}` template placeholder moved from S13.1 to S13.3.

**CI result:** the first run failed three table-coverage tests (`schema-foundation` twice, the owner-export decision test once) because `student_profile` was missing from the exported `schema` object and from `EXPORT_TABLES`. Fixed in the same PR (the profile is in the owner's full export, as lead data already is); I had run only subsets of the integration suite locally, so the full suite (673 tests) is now run before every push. All six checks then passed and the owner asked for the merge on green: PR #46 merged 2026-10-31.

**Not done / owner:** The course field and level reach the live database only when the seed is run against production (needs the owner's go-ahead). The throwaway Neon branch `test-s13-1-migration` still exists and costs nothing while idle; deleting it needs the owner's word. The `CLAUDE.md` Step 2 sentence (F21) was added at the owner's request after this entry (PR #47). No human item was marked done by Claude Code.

### 2026-10-31: Session 42 (owner housekeeping before S13.2)

At the owner's explicit word: (1) the Step 2 sentence was added to `CLAUDE.md` (flag F21 resolved, PR #47); (2) the course field and level were filled on the **live** database with one SQL update through the Neon tools, the same fill the seed performs (it only writes empty values): 77 of 77 programmes filled, totals checked per field and level; (3) the throwaway Neon branch `test-s13-1-migration` was deleted. Then module S13.2 was started.

### 2026-10-31: Session 43 (S13.2 Sign in and Create account)

**Built against:** essentials, architecture and PRD all version 2. Branch `feat/s13-2-sign-in-create-account`.

**Built:** the two-button split (`/sign-in` and `/sign-up`), the "No account found, create one?" confirm screen, and the facade change so a Google return with no `app_user` row goes to onboarding from Sign up and to the confirm screen from Sign in. No pre-check endpoint of any kind exists.

**Tests and CI:** unit, integration and Playwright (new account, returning account, cancel, offline) all green. PR #48 merged on green CI.

### 2026-10-31: Session 44 (S13.3 Onboarding)

**Built against:** essentials, architecture and PRD all version 2. Branch `feat/s13-3-onboarding`.

**Built:** migration `0014_onboarding_v2.sql` (the `app_complete_onboarding` function) plus the student and parent onboarding screens (Basics, School results, Study plan; Who is applying for a parent), a draft kept in IndexedDB until the last screen, and the single idempotent submit that writes the profile, the lead and the audit row together, sharing the offline lead queue's idempotency key.

**Tests and CI:** unit, integration (Postgres) and Playwright (offline then online, duplicate-retry) all green. One flaky concurrent-same-key test was removed (PGlite's single connection cannot exercise real concurrency). PR #49 merged on green CI. **Migration 0014 is merged but was not deployed until this session's deploy run.**

### 2026-10-31: Session 45 (S13.4 Student app)

**Built against:** essentials, architecture and PRD all version 2. Branch `feat/s13-4-student-app`.

**Built:** the student pill bar (Home, Universities, My progress, Help), the personalised Home, the Universities list ordered by the chosen course then best NAAC grade (ties A to Z, unknown grades last and labelled "not stated"), computed client-side from the already-cached public universities data, and the offline snapshot (`progressSnapshot`) with no personal data.

**Tests and CI:** unit (including the NAAC ordering at the boundaries), Playwright at phone width, and a no-personal-data-in-cache test all green. PR #50 merged on green CI.

### 2026-10-31: Session 46 (S13.5 Notifications)

**Built against:** essentials, architecture and PRD all version 2. Branch `feat/s13-5-notifications`.

**Built:** migration `0015_notifications_v2.sql` (the `app_my_notifications` function), the derived notification items for student and staff, the unread dot (`useUnreadCount`, at most once a minute), and "Mark all read". No notifications table, as decided (D11).

**Tests and CI:** unit per event, integration, and Playwright (student and staff pages, the admin menu link) all green. PR #51 merged on green CI. **Migration 0015 is merged but was not deployed until this session's deploy run.**

### 2026-10-31: Session 47 (S13.6 Admin and owner hubs)

**Built against:** essentials, architecture and PRD all version 2. Branch `feat/s13-6-admin-hubs`.

**Built:** the four staff hubs (Home, Leads, Content, Insights) behind the shared pill bar and round More button; `GET admin/home?period=week|month` (the staff Home's tiles, line chart, "Needs you today" and latest activity, one call per role); the legacy redirect map wired into the Worker entry before the session check, so every pre-hub address 301s to its hub section; the three-step first-visit tour per tab (`POST admin/tour.seen`, migration 0013's `app_mark_tour_seen`); the offline dashboard snapshot (IndexedDB v3, totals only, never a lead reference); and a one-line purpose on every admin and owner page. The old `admin/overview` call is unused but not removed (S13.8). The bar and progress-bar chart components named in the design were not built: the funnel and sources already have their own bars in the existing analytics screen.

**Found and fixed during verification (real bugs, not test-only issues):** the admin layout's `clientMessages` call did not load the `shell` message namespace, so `useTranslations("shell")` in the new `AdminShell` silently failed and the entire nav bar did not render; three internal links (`leads-panel.tsx`'s own link-requests tab, and three cases in `notifications-panel.tsx`: link requests, data requests, payment) still pointed at pre-hub addresses instead of the new `?view=` hub addresses — these worked in production only via the Worker's 301, at the cost of an extra round trip, and failed in the Playwright suite which runs against `next start` directly with no Worker in front. All four fixed to link straight to the hub address. A duplicate "Link requests" link (the hub's own section tabs plus the leads list's internal tab) was also found and the redundant one removed. Six e2e tests that referenced the pre-S13.6 "Admin menu" and legacy addresses were rewritten to the new "Main tabs" / More sheet structure.

**Tests and CI:** unit 849, integration (Postgres) 735, Playwright 274/276 (two unrelated pre-existing flaky tests pass in isolation), `tsc --noEmit` and `eslint --max-warnings=0` clean. All 5 CI checks green (build and Worker size, integration, Lighthouse mobile, lint/unit, Playwright). PR #52 merged on green CI.

**Not done / owner:** CPU rows for `POST me/onboarding`, `GET me/home`, the notification calls and `admin/home` are still unmeasured (see CPU rows table; the deploy run started this session includes a CPU measurement pass). The consent text for onboarding is the placeholder `draft-1` (owner item R5, legal text). `admin/overview`'s CPU row stays until S13.8 removes the call.

### 2026-10-31: Session 48 (deploy and tracker update)

**Done at the owner's word ("Run the deploy and write tracker update"):** triggered `stage0-deploy.yml` (workflow_dispatch) on `main` after PR #52, run https://github.com/DivineGima/scollarly/actions/runs/41227691246. **Succeeded in 27m36s.** Migrations 0014 and 0015 applied to the live Neon database (0013 was already live from an earlier session), the Worker rebuilt and deployed to `scollarly.gimafolabit.workers.dev`, secrets set, `/api/v1/health` answered 200, and the CPU measurement ran (30 lead samples). Every measured scenario passed its gate; see the CPU rows table. The 57 throwaway probe users and 67 probe leads the measurement created were removed at the end of the run, as always. **Flag F26** records that S13.4 to S13.6's own new calls have no scenario in the measurement script yet, so their CPU rows stay unmeasured rather than guessed.

### 2026-11-04: Session 51 (merge, deploy and CPU measurement of S13.7 to S13.9)

At the owner's word ("commit push and merge the prs and deploy"): PR #54 (S13.7 to S13.9) had all five CI checks green and was merged; `stage0-deploy.yml` was run on `main` (run 41787942487) and **succeeded** (deploy, secrets, health check 200, CPU measurement, cleanup of the throwaway users and probe leads). The live site answers with the course finder, the header logo and the manifest colour `#1F3BFF`. The run measured every version 2 call; **every row passed** (CPU rows table; flag F26 resolved). A local full Playwright run before the merge passed 293 of 293. S13.7, S13.8 and S13.9 stay `in-progress`: the owner's real-phone icon check (R4), the watched test, the role sign-in checks and the checklist sign-off (H11) are human actions. The Worker size figure is printed in the run's "Worker size gate" step; it passed the 2.6 MiB gate.

### 2026-11-04: Session 50 (S13.7 logo, icons, manifest; F23 and F24 closed)

**Built against:** essentials, architecture and PRD all version 2, on the same branch as Session 49.

**Done:** the supplied image was traced into `public/brand/logo.svg` (black) and `logo-white.svg` by contour tracing of the image's pixels, not by hand (three shapes, about 550 bytes of path, 98.7% pixel overlap with the supplied black mark; the small remainder is edge anti-aliasing). `scripts/make-icons.mjs` was rewritten to build `icon-192`, `icon-512`, `maskable-512` (mark inside the safe zone), `apple-touch-icon` (180), `favicon.ico` (16, 32, 48) and `src/app/icon.svg` from the white logo on `#1F3BFF`, and the outputs were looked at. `manifest.ts` and the page head use `#1F3BFF` for `background_color` and `theme_color`, so the installed app's launch screen is the icon on the brand blue (no script, no delay). The black logo is in the site header; a small logo shows in the loading state of every signed-in screen (a plain image in the cached shell, no timer). 14 new unit tests (`s13-7-brand.test.ts`) read the committed files: vector content, icon sizes and colours, the safe zone, the ICO structure, the manifest, and where the logo is used. FR-30 is now mapped (below).

**Owner to do (R4):** look at the traced logo and the icons (the supplied image was the source, so they should match), then install the app on a real Android phone and check the icon and launch screen, because no tool here can show that. Not marked done.

**Owner answers:** F23 yes, F24 yes (Flags).

### 2026-11-04: Session 49 (S13.7 landing page, S13.8 carry-over, S13.9 QA; flags reviewed)

**Built against:** essentials `system_architecture_essential_2.md`, architecture `system_architecture_2.md`, PRD `PRD_2.md`, all version 2 (N = 2 everywhere). Branch `feat/s13-7-8-9-landing-and-qa`.

**Owner answers recorded (2026-11-04):** the logo image is not in the repository, so the owner designed it with an AI tool from a prompt Claude Code wrote and sent the image in the chat (black mark on white, white mark on `#1F3BFF`); it was traced in Session 50 (below). F23 and F24: the owner said **yes** (both resolved). H24 (Neon compute hours): **keep the link to the Neon console**, no Neon API key and no new secret. F5 and F6: the owner accepted Claude Code's reading of both (see Flags). F8: the owner chose not to change GitHub settings.

**S13.7 built:** the landing page `/` now has the course finder (the page's only script: `src/components/public/course-finder.tsx`, pure rules in `src/modules/content/course-finder.ts`). It lists the owner's twelve courses; choosing one shows the universities that offer it (best NAAC grade first, then A to Z), a course nobody lists yet answers with a message and a WhatsApp link from the one helper (FR-31), and "Create your free account" goes to `/sign-up?course=<course>` (a value that is not on the list carries nothing). A strip of university logos (from our own storage, only for universities that have one) sits below it. The existing hero, process, FAQ teaser and confirmed-only trust blocks are unchanged; the existing install bar already offers install to returning visitors, so no second prompt was added. English and French strings added. `/sign-in` and `/sign-up` were added to the Lighthouse CI list.
**S13.7 brand part:** built in Session 50 once the image arrived (below).

**S13.8 built:** (1) flag F26: `scripts/measure-cpu.mjs` now has scenarios for `account/confirm`, `me/home`, `me/notifications`, `admin/home`, `admin/notifications`, `admin/tour.seen` and the legacy redirect, and `scripts/ci/seed-probe-sessions.mjs` makes 55 pending accounts for the confirm scenario; a unit test keeps the script honest. **The rows are still unmeasured: they are filled by the next deploy-and-measure run.** (2) `docs/pre-launch-checklist.md` extended with R1, R4, R5, R6, F8, the version 2 screens, the watched test and a parent flow. (3) `docs/quota-review.md` has a version 2 re-run with the 2026-10-31 measured CPU figures. (4) S10.2: H24 decided as above.
**S13.8 not done (owner or deploy):** the three modules stay `in-progress`: S10.2 and S11.4 until this pull request's CI is green and the next deploy fills the new CPU rows and the Worker size figure; S11.6 until the owner ticks the checklist and signs off (H11).

**S13.9 built:** `tests/unit/s13-9-traceability.test.ts` maps FR-19 to FR-32 to named tests and fails if one is renamed or deleted (table below); `tests/e2e/s13-9-qa.spec.ts` checks the landing page, Sign in and Sign up at 360 px and 1280 px (one h1, no sideways scroll, axe), reduced motion, and keyboard-only use of the finder; `scripts/smoke.mjs` now checks the version 2 shells, data calls and every legacy redirect. **Smoke run against production: 55 of 55 passed** (visitor level only). The old smoke list expected 404 for `/admin/payments`, which the Worker has redirected since S13.6; it now expects the 301.
**S13.9 not done (human):** the watched test with three real people, the real-phone icon and splash check, and the sign-in smoke test for each role. Claude Code cannot run these; nothing is recorded as done.

**Tests:** unit 916 passed (934 after Session 50); `tsc --noEmit` clean; `eslint` reports no error (one existing warning in `leads-panel.tsx`, an unused disable comment from S13.6, left alone because it is outside this change and CI does not fail on warnings); Playwright for the landing page and QA files 17 of 17 on a production build; `npm run check:bundle` passes (landing page about 103 KB gzip against the 118 KB ceiling). Integration tests were not changed and not re-run. CI on the pull request is the record for the full suites.

**Found:** the pre-hub smoke expectations were stale (above). The essentials text calls for an "install prompt" on the landing page; one already exists site-wide, so none was duplicated. The FR-31 wording ("a course with no university shows a message and WhatsApp") is why the finder lists all twelve courses rather than only the offered ones.

## Flags (need the owner)

Flags carried from tracker_1 (full text in its Flags table). Status on 2026-11-04:

| ID | Status | Detail |
|---|---|---|
| F5 | **Resolved by the owner, 2026-11-04** | The owner accepted that the three carve-outs of ADR-029 (erasure, raw event purge after rollup, expired auth rows) stand beside "no physical deletes in v1". `CLAUDE.md` is the owner's file and was not edited; the owner may add the wording to it. |
| F6 | **Resolved by the owner, 2026-11-04** | The owner accepted that `src/server/db` counts as the repository layer's internals (architecture section 5), so Drizzle stays there and in `server/repositories`. The ESLint rule and the source-scan test already enforce exactly that. |
| F8 | **Open (owner chose no change, 2026-11-04)** | The repository is public today, so GitHub would allow a branch rule on `main`; the owner chose not to change GitHub settings. Protection stays discipline-only. If H20 makes the repository private again, GitHub Free will refuse the rule. Not recorded as an accepted risk because the owner did not say so. |
| F9, F10 | **Open (outside the code)** | The domain `scollarly.co.in` is locked at GoDaddy until the .IN verification is accepted. Launch only. |

Check tracker_1 for any other flag.

| ID | Flag | Why it matters | Needed from owner |
|---|---|---|---|
| F21 | **Resolved 2026-10-31: the owner decided yes (carry S10.2, S11.4, S11.6 into S13.8) and asked Claude Code to add the sentence to `CLAUDE.md` Step 2, done on branch `docs/tracker-s13-1-complete` (PR #47).** `CLAUDE.md` Step 2 says to take the lowest-numbered essentials file that still has an incomplete stage. `system_architecture_essential_1.md` still has Stages 10 and 11 `in-progress` in tracker_1 (modules S10.2, S11.4, S11.6), so the sequence would start from essentials 1, then halt at Step 4 because essentials 1 cites architecture 1 while the current architecture is 2. | Without a decision the start-of-task sequence stops before any Stage 13 work. Claude Code does not edit `CLAUDE.md` (the owner's file). | **Resolved 2026-10-31** (decision R8, option a). |
| F22 | Google's OAuth app is in Testing mode with the owner as the only test user (H8, H21). | Real students cannot sign up, so the first real onboarding cannot happen. | **Open (owner action R1).** Publishing the Google app is the owner's step in the Google console; Claude Code cannot do it or mark it done. |
| F23 | The design document and PRD_2's first draft said "new programme columns" and "no row until confirm"; the code shows otherwise (see Session 40). | The approved wording and the built behaviour differ slightly. | **Resolved by the owner, 2026-11-04: "yes"** to the five points of the architecture's amendment log. |
| F24 | S13.6 built no new `GET admin/insights?view=` call (the existing analytics, performance and payments calls are reused) and did not build the bar/progress-bar chart components named in the design, since the analytics screen already has its own bars. | The built screen differs slightly from the original design document's wording. | **Resolved by the owner, 2026-11-04: "yes"** to the built screen differing from the design wording as described in the S13.6 amendment (system_architecture_2.md). |
| F25 | The onboarding consent text is the placeholder `draft-1`, not real legal text. | Real students should not see placeholder consent wording at launch. | **Open.** Covered by owner action R5. |
| F26 | `scripts/measure-cpu.mjs` was never extended with scenarios for the S13.4, S13.5 and S13.6 calls (`me/home`, `me/notifications`, `admin/notifications`, `admin/home`, `admin/tour.seen`, the legacy redirect). Architecture 21.13 and the working rules ask for a measured CPU row on every new function; these rows are still blank after a real deploy and measurement run, not because the run failed but because no scenario exists for them. | The CPU gate (8 ms warm p95) is unverified for these calls in production. | **Resolved 2026-11-04.** Session 49 added a scenario for every one of these calls (`measure-cpu.mjs`, `seed-probe-sessions.mjs`, tested by `tests/unit/s13-8-cpu-scenarios.test.ts`). The deploy-and-measure run of 2026-11-04 filled every row and each passed the gate (warm p95 at most 4 ms, none cut). |

## Stage status

Allowed status values: `in-progress`, `complete`. A stage or module with no entry has not started, shown as a dash.

| Stage | Name | Module IDs | Status |
|---|---|---|---|
| 0 to 9, 12 | Version 1 stages | see tracker_1 | **complete** (as recorded in tracker_1; not re-opened by the refactor) |
| 10 | Owner pages and operations (version 1) | S10.1 to S10.4 | in-progress (S10.1, S10.3, S10.4 complete; **S10.2 carried into S13.8**) |
| 11 | Hardening and launch readiness (version 1) | S11.1 to S11.8 | in-progress (**S11.4 and S11.6 carried into S13.8**; the rest complete) |
| 13 | Refactor (one stage, essentials 2) | S13.1 to S13.9 | in-progress (S13.1 to S13.6 complete; S13.7 to S13.9 in-progress, see the registry) |

## Module registry (Stage 13)

| Module ID | Module | Status |
|---|---|---|
| S13.1 | Foundations and shared parts (migration 0013, nav config and shell components, course list, redirects) | complete (2026-10-31: PR #46 merged, all six CI checks green; unit 708, integration 673, migration applied to a throwaway Neon branch of production) |
| S13.2 | Sign in and Create account | complete (2026-10-31: PR #48 merged, CI green) |
| S13.3 | Onboarding (student and parent) | complete (2026-10-31: PR #49 merged, CI green; migration 0014) |
| S13.4 | Student app (tabs, Home, Universities ordering, offline copy) | complete (2026-10-31: PR #50 merged, CI green) |
| S13.5 | Notifications | complete (2026-10-31: PR #51 merged, CI green; migration 0015) |
| S13.6 | Admin and owner hubs and CRM dashboards | complete (2026-10-31: PR #52 merged, all 5 CI checks green; unit 849, integration 735, Playwright 274/276) |
| S13.7 | Landing page and brand | in-progress (2026-11-04: landing page, course finder, logo strip, traced logo, icon set, manifest and loading logo built and tested; open: green CI on the pull request and the owner's real-phone icon check, R4) |
| S13.8 | Carry-over from Stages 10 and 11 (S10.2, S11.4, S11.6) | in-progress (2026-11-04: CPU scenarios, checklist and quota re-run written, H24 decided; waits for CI and the next deploy's measurements, and for the owner's checklist and sign-off H11) |
| S13.9 | Watched test and QA | in-progress (2026-11-04: traceability map, QA sweep and smoke script built; the watched test and the role sign-in checks are human actions) |

## CPU rows to record (architecture 21.13; fill in at each measurement)

Measured by `scripts/measure-cpu.mjs` against `scollarly.gimafolabit.workers.dev` in the deploy run of 2026-10-31 (https://github.com/DivineGima/scollarly/actions/runs/41227691246, 30 lead samples). Session 49 added a scenario for every new call (flag F26) and the deploy-and-measure run of 2026-11-04 (https://github.com/DivineGima/scollarly/actions/runs/41787942487) measured them: 50 requests per row, warm p50 and p95 from `wrangler tail`, worst of all requests, none cut at the limit. `wrangler tail` delivered 22 to 26 events for most 50-request rows (the same sampling as the 2026-10-31 run), so the statistics rest on the delivered events, not on 50 each.

| Row | Warm p50 | Warm p95 | Worst | Cut at limit | Gate (p95 at most 8 ms, none cut) | Run |
|---|---|---|---|---|---|---|
| `POST me/onboarding` (one function: lead, profile, audit row) | 2 ms | 4 ms | 5 ms | 0 | **PASS** | 2026-11-04, run 41787942487 |
| `GET me/home` | 2 ms | 4 ms | 5 ms | 0 | **PASS** | 2026-11-04, run 41787942487 |
| `GET me/notifications` | 2 ms | 3 ms | 3 ms | 0 | **PASS** | 2026-11-04, run 41787942487 |
| `GET admin/notifications` | 2 ms | 3 ms | 4 ms | 0 | **PASS** | 2026-11-04, run 41787942487 |
| `POST account/confirm` | 2 ms | 4 ms | 5 ms | 0 | **PASS** | 2026-11-04, run 41787942487 |
| `GET admin/home` (week) | 2 ms | 3 ms | 3 ms | 0 | **PASS** | 2026-11-04, run 41787942487 |
| `GET admin/insights` (funnel, sources, performance, payments) | 2 ms | 3 ms | 6 ms | 0 | **PASS** (the existing analytics read: p50 2, p95 3, worst 6; the payments read: p50 2, p95 3, worst 3. Each view is one of these reads.) | 2026-11-04, run 41787942487 |
| `POST admin/tour.seen` | 2 ms | 4 ms | 4 ms | 0 | **PASS** | 2026-11-04, run 41787942487 |
| Legacy redirect (301 from the Worker entry) | 0 ms | 0 ms | 0 ms | 0 | **PASS** | 2026-11-04, run 41787942487 |
| Landing page (cache hit), the public-page row | 0 ms | 1 ms | 151 ms | 0 | **PASS** (the 151 ms worst is the first request of a fresh instance, which pays the Worker start-up; no request was cut) | 2026-11-04, run 41787942487 |

## Traceability (to be filled at S13.9): FR-19 to FR-32 mapped to passing tests

Mapped 2026-11-04 in `tests/unit/s13-9-traceability.test.ts`, which fails if a named test is renamed or removed. "Passing" is the CI result of the pull request that merges this map; the local run on 2026-11-04 had the unit suite at 916 of 916 and the landing page and QA specs at 17 of 17.

| FR | Proving tests (file: title) | Status |
|---|---|---|
| FR-19 hubs and tab bar, server-decided access | e2e s13-6 "shows an admin the four tabs and a More sheet"; e2e s13-4 "shows the four student tabs and the More button"; unit s13-foundations "never offers an admin an owner-only row"; integration s13-6 "refuses a student, and a signed-out caller" | mapped |
| FR-20 one data call per tab, old addresses redirect | unit s13-foundations "the legacy admin addresses"; unit s13-6 "moves each to the section that took its place"; e2e s13-6 "Leads has the list, the link requests"; smoke script (every redirect) | mapped |
| FR-21 purpose line, empty state, first-visit tour once | e2e s13-6 "shows three steps once", "the pages that are reached from More say what they are for", "says what to do when nothing has happened" | mapped |
| FR-22 landing page, finder, budgets | e2e s13-7 "the finder lists the right universities", "axe finds no WCAG 2.1 A or AA violation", "the landing page shows no team bios"; unit s13-7 "the universities for one course"; `npm run check:bundle`; Lighthouse CI | mapped |
| FR-23 sign in and create account split, no enumeration | unit s13-2 "has no endpoint that says whether an email has an account"; integration s13-2 "shows the confirm screen and confirms nothing", "refuses everything but account/confirm"; e2e s13-2 "is not served to someone who is signed out" | mapped |
| FR-24 one lead per finished onboarding | integration s13-3 "answers the same request again with the same lead", "lets a second device carry on", "still creates the lead, and shows both to admins as a duplicate, never merged"; e2e s13-3 "offline: saves on the phone, then sends exactly once" | mapped |
| FR-25 relationship, no fourth role | integration s13-3 "the profile the relationship", "refuses a staff account: only a student-role account has an onboarding" | mapped |
| FR-26 pre-selected answers, ordering, no personal data in caches | unit s13-4 "treats several chosen courses", "never keeps anything else signed-in"; integration s13-4 "returns the student's own answers and first name only"; e2e s13-4 "starts with the student's own courses ticked" | mapped |
| FR-27 derived notifications | unit s13-5 "is unread again the next day"; integration s13-5 "marks all read without losing the list"; e2e s13-5 "Mark all read clears" | mapped |
| FR-28 tiles, chart, period switch | unit s13-6 "gives an admin their working numbers"; integration s13-6 "gives an admin no payment and no onboarding number"; e2e s13-6 "gives the owner the owner's four tiles" | mapped |
| FR-29 offline copies, deleted on sign-out | e2e s13-6 "keeps the numbers and the chart, never a lead reference"; e2e s13-4 "keeps the first name, the courses and the stage", "sign-out forgets the copy on the phone", "a different student signing in on the same phone sees nothing of the first" | mapped |
| FR-30 logo vector, icon set, installed splash | unit s13-7-brand "is one path in black for the website and the same path in white for dark backgrounds", "keeps the whole mark inside the maskable icon's safe zone", "launches on the brand blue", "shows the black logo in the site header"; the real-phone check is manual (R4) | mapped (manual phone check pending) |
| FR-31 course and level on every programme, plain message and WhatsApp | unit s13-foundations "files every programme in the real seed under a field and a level"; e2e s13-7 "a course no university lists says so and offers WhatsApp" | mapped |
| FR-32 translation keys | unit s13-foundations "has the same keys in English and French"; unit s13-3 "has a title for every screen"; unit s13-7 "English and French have the same finder keys" | mapped |

## Watched test log (S13.9)

| Person | Flow | First place they got lost | What changed |
|---|---|---|---|
| (student) | | | |
| (parent) | | | |
| (admin) | | | |

## Owner actions (human, never marked done by Claude Code)

Recorded only when the owner says so.

### New in the refactor

| # | Action | Needed before | Status |
|---|---|---|---|
| R1 | Publish Google's OAuth app (Testing mode today, owner is the only test user) | First real onboarding | Open |
| R2 | Approve the course categories and the level of each of the 77 programmes (Claude Code proposes a mapping) | S13.3 and S13.4 | **Approved by the owner 2026-10-31 ("all yes")**, with M.Tech filed under "Engineering (postgraduate)", the option offered. The mapping is in `src/lib/courses.ts`. The values reach the live database only when the seed is run against production (owner go-ahead needed). |
| R3 | NAAC grades for the 5 universities without one, or accept "not stated, listed last" | S13.4 | **Decided by the owner 2026-10-31: leave them not stated.** |
| R4 | Confirm the dark neon blue hex (proposed `#1F3BFF`) and check the traced logo | S13.7 | **Hex confirmed by the owner 2026-10-31 ("yes").** On 2026-11-04 the owner sent the logo image; Claude Code traced it and built the icons (Session 50). The owner's check of the trace and of the installed icon on a real phone is still to do. |
| R5 | Legal check and text for a parent applying for a child, minors, and consent for automatic lead creation (extends H5) | Launch | Open |
| R6 | Trust content for the landing page (E1 to E3) | Launch | Open |
| R7 | Confirm Stage 13 and the S13.x numbering | Start of the stage | **Confirmed by the owner 2026-10-31.** |
| R8 | Decide `CLAUDE.md` Step 2 (flag F21) | Start of the stage | **Decided yes 2026-10-31; the sentence was added to `CLAUDE.md` Step 2 at the owner's request (PR #47).** |
| R9 | Merge the pull request that adds PRD_2, architecture 2, essentials 2, tracker_2 and the design document | Start of S13.1 | **Done: the owner merged PR #45 (2026-10-31).** |

### Carried from tracker_1 (open items only; full text and the done items are in tracker_1)

| # | Action | Needed before |
|---|---|---|
| H4 / E1 to E3 | Real figures, consented testimonials with proof, confirmed team bios (the owner said these come at the end) | Launch |
| H5 / E4 | Legal text for privacy and terms and the check on minors and data protection | Launch |
| H7 / E7 | Domain `scollarly.co.in` pointed at Cloudflare (blocked by the .IN verification, F10) | Launch |
| H9 | Remaining [Mine, confirm] items in the version 1 documents | Before the stage that uses each |
| H10 | Metric targets and the pipeline freshness "N days" | After 4 weeks of data |
| H11 | Owner sign-off of the pre-launch checklist (S11.6, carried into S13.8) | Launch |
| H12 | Neon Object Storage free-plan limits (the pricing page showed 5 GB and no request or transfer limit) | Before launch |
| H14 | Monthly run of `scripts/backup-images.mjs` and after any bulk upload | Monthly |
| H19 / E5 | Real phone check of the WhatsApp and lead flow, online and in airplane mode | Launch |
| H20 | Make the GitHub repository private again | After the measurements |
| H21 | Why a Google account not on the test-user list could sign up; decide whether sign-ups should be restricted (now also covered by R1) | S11.6 / S13.8 |
| H24 | Neon compute hours: **decided by the owner 2026-11-04: keep the link to the Neon console** and check its usage page after the first week and monthly (S10.2, carried into S13.8). No Neon API key, no new secret. | Decided; the habit of checking is the owner's |
| E6, E8 | Remaining confirmations, metric targets, and fee confirmation per university | Launch |

## Project understanding (for future sessions)

- **Product:** Scollarly connects African students (Cameroon, Nigeria, Ghana, Ivory Coast, Senegal, Guinea, South Africa) with Indian universities. Students pay nothing. Universities pay Scollarly in USD after enrolment. Version 1 is built and live on Cloudflare Workers Free (Next.js on OpenNext, Neon Postgres and Neon Auth, Neon Object Storage, Serwist and idb). The refactor (version 2) reshapes the signed-in app and the home page without changing the stack.
- **Roles:** exactly three: student, admin, owner. One owner. A parent is a student account with `relationship = parent`. Owner powers need a 2FA-verified session.
- **Refactor in one paragraph:** four tabs per role plus a round More button; Sign in and Create account are separate and a new Google login is not a Scollarly account until confirmed; onboarding for students and parents creates one lead in one idempotent write; the student sees their name and universities ordered by chosen course then NAAC grade, computed on the phone; notifications are derived from stored data with one last-seen time per user; staff dashboards show four tiles, one chart and one list; the landing page at `/` has a course finder and shows only confirmed facts; the logo is a traced vector used white on dark neon blue for the icon and splash.
- **Hard rules (unchanged):** never push to `main`; feature branch and pull request for every change; only `server/repositories` imports Drizzle, only `server/auth` imports the Neon Auth SDK and otpauth, only `server/media` uses the storage client, nothing imports Resend; no access control in middleware (the auth facade, `Actor` and row level security are the two locks); signed-in screens are a data-free shell plus plain data functions; no personal data in a shell or any cache; no admin library in a public route; no third-party scripts, hotlinked images or Next.js image optimiser; one WhatsApp helper; no physical deletes; no personal data in logs or events; UTC in storage and WAT for display; additive-first migrations; no paid service and no change of host; unconfirmed statistics, testimonials and bios are never published.
- **CPU rule:** about 10 ms per request on Workers Free; one screen means one data call; every new function gets a measured CPU row.
- **Build order for the refactor:** S13.1, S13.2, S13.3, S13.4, then S13.5, S13.6, S13.7, then S13.9; S13.8 alongside.
