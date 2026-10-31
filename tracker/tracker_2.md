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
| Phase | Stages 0 to 9 and 12 of version 1 are complete and live (see tracker_1). Stages 10 and 11 are `in-progress` in tracker_1 and their three open modules are carried into S13.8. **The refactor documents are written; no refactor code exists yet.** |
| Next stage | **Stage 13 (the refactor), module S13.1.** Waiting on: the owner merging the pull request that adds these four files; the owner's answers to the R items below that block S13.1 to S13.4 (R2 course list, R7 numbering, R8 `CLAUDE.md` Step 2). |
| Blocked by | Nothing blocks starting S13.1 except flag F21 (the `CLAUDE.md` Step 2 question). R1 (publish Google's OAuth app) blocks the first real onboarding, not the build. |

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

## Flags (need the owner)

Open flags carried from tracker_1 (full text in its Flags table; only items tracker_1 showed as Open when this file was written): **F5** (`CLAUDE.md` "no physical deletes" versus the ADR-029 carve-outs), **F6** (`server/db` imports Drizzle), **F8** (branch protection on a private repository), **F9 and F10** (the domain `scollarly.co.in` and the .IN verification, launch only). Check tracker_1 for any other flag.

| ID | Flag | Why it matters | Needed from owner |
|---|---|---|---|
| F21 | `CLAUDE.md` Step 2 says to take the lowest-numbered essentials file that still has an incomplete stage. `system_architecture_essential_1.md` still has Stages 10 and 11 `in-progress` in tracker_1 (modules S10.2, S11.4, S11.6), so the sequence would start from essentials 1, then halt at Step 4 because essentials 1 cites architecture 1 while the current architecture is 2. | Without a decision the start-of-task sequence stops before any Stage 13 work. Claude Code does not edit `CLAUDE.md` (the owner's file). | **Open.** Recommendation: (a) accept that S10.2, S11.4 and S11.6 are carried into S13.8 and that tracker_2 closes Stages 10 and 11 of version 1 as "handed over", then add one sentence to `CLAUDE.md` Step 2 saying so; or (b) finish the three modules inside version 1 first. Decision R8. |
| F22 | Google's OAuth app is in Testing mode with the owner as the only test user (H8, H21). | Real students cannot sign up, so the first real onboarding cannot happen. | **Open.** Owner action R1: publish the OAuth app when ready. |
| F23 | The design document and PRD_2's first draft said "new programme columns" and "no row until confirm"; the code shows otherwise (see Session 40). | The approved wording and the built behaviour differ slightly. | **Open for confirmation.** The architecture's amendment log lists the five points; the owner confirms or overrules each. |

## Stage status

Allowed status values: `in-progress`, `complete`. A stage or module with no entry has not started, shown as a dash.

| Stage | Name | Module IDs | Status |
|---|---|---|---|
| 0 to 9, 12 | Version 1 stages | see tracker_1 | **complete** (as recorded in tracker_1; not re-opened by the refactor) |
| 10 | Owner pages and operations (version 1) | S10.1 to S10.4 | in-progress (S10.1, S10.3, S10.4 complete; **S10.2 carried into S13.8**) |
| 11 | Hardening and launch readiness (version 1) | S11.1 to S11.8 | in-progress (**S11.4 and S11.6 carried into S13.8**; the rest complete) |
| 13 | Refactor (one stage, essentials 2) | S13.1 to S13.9 | - (not started) |

## Module registry (Stage 13)

| Module ID | Module | Status |
|---|---|---|
| S13.1 | Foundations and shared parts (migration 0013, nav config and shell components, course list, redirects) | - |
| S13.2 | Sign in and Create account | - |
| S13.3 | Onboarding (student and parent) | - |
| S13.4 | Student app (tabs, Home, Universities ordering, offline copy) | - |
| S13.5 | Notifications | - |
| S13.6 | Admin and owner hubs and CRM dashboards | - |
| S13.7 | Landing page and brand | - |
| S13.8 | Carry-over from Stages 10 and 11 (S10.2, S11.4, S11.6) | - (carried items are `in-progress` in tracker_1) |
| S13.9 | Watched test and QA | - |

## CPU rows to record (architecture 21.13; fill in at each measurement)

| Row | Warm p50 | Warm p95 | Worst | Cut at limit | Gate (p95 at most 8 ms, none cut) | Run |
|---|---|---|---|---|---|---|
| `GET me/home` | | | | | | |
| `GET me/notifications` | | | | | | |
| `GET admin/notifications` | | | | | | |
| `POST me/onboarding` | | | | | | |
| `POST account/confirm` | | | | | | |
| `GET admin/home` | | | | | | |
| `GET admin/insights` (funnel, sources, performance, payments) | | | | | | |
| Legacy redirect | | | | | | |
| Landing page (cache hit) | | | | | | |

## Traceability (to be filled at S13.9): FR-19 to FR-32 mapped to passing tests

| FR | Test | Status |
|---|---|---|
| FR-19 to FR-32 | to be mapped | - |

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
| R2 | Approve the course categories and the level of each of the 77 programmes (Claude Code proposes a mapping) | S13.3 and S13.4 | Open |
| R3 | NAAC grades for the 5 universities without one, or accept "not stated, listed last" | S13.4 | Open |
| R4 | Confirm the dark neon blue hex (proposed `#1F3BFF`) and check the traced logo | S13.7 | Open |
| R5 | Legal check and text for a parent applying for a child, minors, and consent for automatic lead creation (extends H5) | Launch | Open |
| R6 | Trust content for the landing page (E1 to E3) | Launch | Open |
| R7 | Confirm Stage 13 and the S13.x numbering | Start of the stage | Open |
| R8 | Decide `CLAUDE.md` Step 2 (flag F21) | Start of the stage | Open |
| R9 | Merge the pull request that adds PRD_2, architecture 2, essentials 2, tracker_2 and the design document | Start of S13.1 | Open |

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
| H24 | Neon compute hours: keep the console link or add a measurement (S10.2, carried into S13.8) | Before launch |
| E6, E8 | Remaining confirmations, metric targets, and fee confirmation per university | Launch |

## Project understanding (for future sessions)

- **Product:** Scollarly connects African students (Cameroon, Nigeria, Ghana, Ivory Coast, Senegal, Guinea, South Africa) with Indian universities. Students pay nothing. Universities pay Scollarly in USD after enrolment. Version 1 is built and live on Cloudflare Workers Free (Next.js on OpenNext, Neon Postgres and Neon Auth, Neon Object Storage, Serwist and idb). The refactor (version 2) reshapes the signed-in app and the home page without changing the stack.
- **Roles:** exactly three: student, admin, owner. One owner. A parent is a student account with `relationship = parent`. Owner powers need a 2FA-verified session.
- **Refactor in one paragraph:** four tabs per role plus a round More button; Sign in and Create account are separate and a new Google login is not a Scollarly account until confirmed; onboarding for students and parents creates one lead in one idempotent write; the student sees their name and universities ordered by chosen course then NAAC grade, computed on the phone; notifications are derived from stored data with one last-seen time per user; staff dashboards show four tiles, one chart and one list; the landing page at `/` has a course finder and shows only confirmed facts; the logo is a traced vector used white on dark neon blue for the icon and splash.
- **Hard rules (unchanged):** never push to `main`; feature branch and pull request for every change; only `server/repositories` imports Drizzle, only `server/auth` imports the Neon Auth SDK and otpauth, only `server/media` uses the storage client, nothing imports Resend; no access control in middleware (the auth facade, `Actor` and row level security are the two locks); signed-in screens are a data-free shell plus plain data functions; no personal data in a shell or any cache; no admin library in a public route; no third-party scripts, hotlinked images or Next.js image optimiser; one WhatsApp helper; no physical deletes; no personal data in logs or events; UTC in storage and WAT for display; additive-first migrations; no paid service and no change of host; unconfirmed statistics, testimonials and bios are never published.
- **CPU rule:** about 10 ms per request on Workers Free; one screen means one data call; every new function gets a measured CPU row.
- **Build order for the refactor:** S13.1, S13.2, S13.3, S13.4, then S13.5, S13.6, S13.7, then S13.9; S13.8 alongside.
