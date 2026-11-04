# Tracker 3: Scollarly v3 (Stage 14)

Maintained by Claude Code. Human actions (legal review, DNS, OAuth credentials, Google console, vendor terms, owner sign-off) are recorded here only when the owner says they are done.

This tracker starts version 3 (PRD_3, architecture 3, essentials 3). `tracker_2.md` is the history of Stage 13 (S13.1 to S13.9) and `tracker_1.md` of Stages 0 to 12; both stay in the repository. Where a row below says "see tracker_2" or "see tracker_1", the full text and the evidence are there. Open items are carried here unchanged.

## Current position

| Item | Value |
|---|---|
| Current PRD | `PRD_3.md` (2026-11-04, full copy: part A amendments, part B the whole of PRD_2) |
| Current architecture | `system_architecture_3.md` (2026-11-04, derived from `PRD_3.md`; section 22 wins over older text) |
| Essentials file | `essentials/system_architecture_essential_3.md` (Stage 14, one stage) |
| Phase | Stage 13 modules S13.1 to S13.6 complete; S13.7 to S13.9 built and deployed but `in-progress` (owner-paced items, carried into S14.8). **Stage 14: S14.1 to S14.8 built, merged (PR #68, #69) and deployed 2026-11-04; the deploy workflow's CPU rows pass. The campus tours were applied to the live database the same day. What the owner must still do and check is in the checklist, section E3.** |
| Next module | None to build. The owner tests the live site (checklist E3). The carried owner-paced items (S13.7, S13.8, S13.9, S10.2, S11.4, S11.6) stay `in-progress`. |
| Blocked by | Nothing blocks the code. |

## Start-of-task check results (CLAUDE.md steps 1 to 7), 2026-11-04

| Step | Result |
|---|---|
| 2 essentials file | `system_architecture_essential_3.md` exists; `CLAUDE.md` Step 2 (owner decision 2026-11-04) selects it while Stage 14 is incomplete |
| 3 architecture version | highest `system_architecture_N.md` is 3 |
| 4 essentials vs architecture | essentials 3 cites `system_architecture_3.md`: match |
| 5 PRD version | highest `PRD_N.md` is 3 |
| 6 architecture vs PRD | architecture 3 says `Derived From: PRD_3.md`: match |
| Version alignment | PRD 3, architecture 3, essentials 3: same N, each cites its own N |

## Standing owner check-ins

| # | Check | Link | Status |
|---|---|---|---|
| C1 | Has Neon Auth shipped authenticator-app 2FA (MFA/TOTP)? | https://neon.com/docs/auth/roadmap | **Paused by the owner (2026-10-24).** Do not ask again until about 2026-11-24. |

## Module registry (Stage 14)

| ID | Module | Status | Last session |
|---|---|---|---|
| S14.1 | Quick fixes (fees, underlines, footer text) | complete (merged in #59 and #62, CI green) | Session 2 |
| S14.2 | Privacy and Terms | complete in code (merged in #62); owner legal review R5 still open | Session 2 |
| S14.3 | Account-first actions | complete (merged in #62, CI green); onboarding return after sign-up lands in S14.5 | Session 2 |
| S14.4 | Email and password | complete in code (merged in #62); enabled in Neon Auth; **not deployed and not yet tried against real Neon Auth**; the review found the facade rejected unverified emails (fixed in `fix/s14-review`) | Session 3 |
| S14.5 | Onboarding first | complete, deployed 2026-11-04 (migration 0017 applied) | Session 4 |
| S14.6 | Real tours | complete, deployed; 8 verified videos published and 3 placeholder videos archived on the live database | Session 4 |
| S14.7 | CRM charts, board, filters, export | complete, deployed | Session 4 |
| S14.8 | QA, deploy and carry-over | complete for what code can do (traceability, checklist, deploy, CPU rows, F30, F32). The owner-paced items carried from Stages 10, 11 and 13 stay `in-progress` until the owner says they are done | Session 4 |

Carried and still `in-progress` (owner-paced, see tracker_2): S13.7, S13.8, S13.9, S10.2, S11.4, S11.6.

## Session log

### 2026-11-04: Session 3 of tracker_3 (code review of S14.1 to S14.4, fixes)

An independent code review raised 10 findings; each was checked against the code. Confirmed and fixed in branch `fix/s14-review`: (1) **password sign-in could not log anyone in** because the facade rejected any unverified email, and Neon creates password accounts unverified; the facade now trusts an unverified session for a student only (one shared rule, `trusted-session.ts`), staff still need a verified email; migration 0016 lets a password student's own lead link; (2) the lead endpoint and the facade now use the same rule; (3) the lead endpoint limits by address before the session lookup; (4) password limits per address and per email (the documents had claimed a lockout that does not exist); (5) stale comments; (8) the public path list moved to `src/lib/public-paths.ts` so client code does not import edge code; (10) one `configFromEnv`. Not a bug: the invite page offers Google only. Not in this change: the frame policy (F31, S14.6) and the Neon exposure (F30, owner decision). Documents corrected: architecture 22.2 and 22.3 (hint is localStorage plus a `#signed-in` fragment, not a cookie; route names; component names; the limits and the trust rule), PRD_3 F21, essentials 3 (tracker name and test wording), this tracker.

### 2026-11-04: Session 2 of tracker_3 (S14.1 to S14.4 built; essentials 3, architecture 3)

Built on branches stacked in order (PR #59 S14.1, PR #60 S14.2, S14.3 and S14.4 next). **S14.1:** fees removed from every public read, page, card and offline copy; `/fees` answers 301 to `/universities`; links are not underlined (line on hover, focus and in long text); footer tagline without "Free for students". **S14.2:** full Privacy policy and Terms of use in English and French. **S14.3:** sign-in pop-up (`GateRuntime`), `GateLink` on Apply and WhatsApp buttons, `RequireAccount` on `/apply`, a `next` allow-list carried through Google sign-in, and the server lock in `POST /api/v1/leads` (401 `UNAUTHENTICATED` without a session, 403 `ACCOUNT_NOT_CONFIRMED`). A signed-in hint on the phone (localStorage, set by the signed-in screens and by the `#signed-in` fragment after sign-in) picks between the real button and the pop-up; it grants nothing. The contact page has no form (only WhatsApp, phone, email and an Apply link); phone and email stay visible as contact information. **S14.4:** `POST /api/auth/sign-up/email` and `/sign-in/email` as Worker functions with validation, rate limit and one fixed error answer; forms on both pages. **Not live yet:** email and password is switched off in Neon Auth (flag F27). Sign-in and sign-up page text "No Google account? You can still apply..." was replaced because it is no longer true.

### 2026-11-04: Session 1 of tracker_3 (setup)

Created this tracker at the owner's request (it had not been created when the v3 documents were merged). The v3 documents are in place (PRs #56 and #57); `CLAUDE.md` Step 2 points to version 3. Next: plan and build S14.1 to S14.4.

### 2026-11-04: Session 4 (S14.5 to S14.8)

Built against essentials 3 and architecture 3 (PRD_3). S14.5 onboarding first (migration 0017), S14.6 real tours (8 verified videos, frame policy), S14.7 CRM (overview, pipeline board, filters, CSV export). S14.8: one release branch holding all three; the leads list now runs in one database round trip (F32); F30 repaired with migration 0018 (staff and the owner cannot hold a session on an account that has a password login; checked that the owner has none); a small phone-width overflow in the CRM charts found by CI was fixed; `seed-content` workflow added (manual, `main` only) to put the tour videos and preview pictures on the live database and archive the earlier placeholder videos; traceability test `tests/unit/s14-8-traceability.test.ts` maps F15, F18, F20, F21, F22, F23 and the fee removal to tests; the pre-launch checklist has a new section E3. Open: deploy, the live CPU run (new rows crm, pipeline, crm-export; leads list), and the owner's own tests.

### 2026-11-04: Session 5 (deploy and live checks)

Merged PR #68 (S14.5 to S14.8) and #69 (a fix to the tours-only seed), deployed with the CPU measurement (run 41843245454: 29 of 30 rows pass, the leads list at 6 ms; **one row fails: "Image serve, first request (cache miss)", warm p95 18 ms against 8, with 3 of 9 requests failing (two connection failures, one 502), so it looks like a storage or network fault and not CPU time; re-run to confirm, see flag F33**). Migrations 0017 and 0018 are applied. The tour pictures and 8 tour rows were added by the `seed-content` workflow (the rows arrive as drafts); the 8 verified rows were then published and the 3 old placeholder videos archived with one scoped SQL change through the Neon tool. Public pages refresh within an hour (hourly regeneration), so the tours page shows the new videos after its next refresh. Not verified by a test: a real email sign-up and sign-in against Neon Auth on the live site, and the Google console publish (owner actions).

## Flags (need the owner)

| # | Flag | Status |
|---|---|---|
| F8 | Branch protection on `main`: the owner chose no GitHub change (2026-11-04); protection is discipline-only. | **Open** (carried) |
| F9, F10 | Domain `scollarly.co.in` and its .IN verification (outside the code). | **Open** (carried, see tracker_2) |
| F22 | Google's OAuth app is in Testing mode with the owner as the only test user. | **Open (owner action R1)** |
| F25 | The onboarding consent text is the placeholder `draft-1`. | **Open (owner action R5)** |
| F27 | Email and password: Neon Auth may force email verification that needs a sender (no paid service allowed). | **Gate G1 checked 2026-11-04: passes.** The Neon Auth project (`aged-recipe-72220939`, production) supports email and password on the plan we use. It is **switched off today** (`email_password.enabled: false`) and verification is not required (`verify_email_on_sign_up: false`), so no email sender is needed. Neon also lists a shared sender (`auth@mail.myneon.app`), but it is for testing, not production. **Owner decided 2026-11-04 ("yes enable"):** email and password switched on in the production Neon Auth settings by Claude Code with `neon neon-auth config email-password update --enabled true --require-email-verification false` (verification off, no verification emails; before, it required verification but sent none, which would have locked new users out). Accepted consequence: a person can sign up with an email they do not own. To undo: `--enabled false`. **Resolved** (code live only after the next deploy). |
| F30 | Email and password is on in Neon Auth with verification off. (a) Neon Auth's own public address answers email routes outside our Worker limits. (b) A stranger can register a password account on someone else's email; if that email later belongs to staff who sign in with Google, Neon may link the two. | **Repaired in code 2026-11-04 (owner asked for a repair with the tools we have).** Migration `0018_staff_no_password_login.sql`: a session whose account holds a password login (`credential` account in Neon Auth) is never resolved for the admin or owner role, so the linked-account takeover gets no staff session; staff and the owner use Google only. Checked on production: the owner has no password login. Test: `tests/integration/f30-staff-no-password.test.ts`. Students may still use unverified password accounts (they only reach their own data). **Residual, accepted:** (a) cannot be closed from our side without an email sender (Neon's shared sender is not meant for production); a stranger can still create student accounts directly at Neon, which are limited to their own data. `allow_localhost` is on in the Neon Auth settings and cannot be changed with the tools we have; recorded for the owner. If a staff member is ever locked out by this rule, the owner removes the password account in the Neon console. |
| F31 | The page security policy allowed any https address as a frame on every page. | **Resolved in S14.6**: `frame-src` lists the YouTube privacy domain, Turnstile and the two seeded 360 tour hosts only (`src/lib/tour-hosts.ts`). |
| F32 | The staff leads list measured a warm p95 of 9 and 19 ms (gate 8). It ran four database round trips. | **Resolved 2026-11-04**: one round trip; the live measurement after the deploy shows warm p50 3 ms, p95 6 ms. |
| F33 | The image CPU rows are intermittent. Deploy run 41843245454: cache-miss row failed (p95 18 ms vs 8; 2 requests got no answer, 1 got a 502), cache-hit row passed (3 ms). Re-run 41852502423 (images only, right after a fresh deploy): cache-miss passed (p95 7 ms, 9 of 9 answered), cache-hit failed (warm p50 1 ms, p95 41 ms: a few slow outliers). The image code was not changed in Stage 14. | **Open, not a Stage 14 regression as far as the evidence goes.** Each row passed in one of two runs; medians are 1 to 3 ms. Needs one more watched run; if a row keeps failing, the cause is outside this stage (storage latency or a cold instance) and is reported, not hidden. |
| F28 | `CLAUDE.md` Step 2 pointed at essentials 2. | **Resolved 2026-11-04** (owner said yes). |
| F29 | PRD_3 and architecture 3 were amendment texts. | **Resolved 2026-11-04** (full copies made). |

## CPU rows to record (architecture 22.8, measured by `scripts/measure-cpu.mjs`)

Rows measured for version 2 are in tracker_2 and all passed. New rows for Stage 14 (gate: warm p95 at most 8 ms, none cut):

| Row | Warm p50 | Warm p95 | Worst | Cut | Gate | Run |
|---|---|---|---|---|---|---|
| Password sign-up and sign-in (S14.4) | | | | | | Not in the measurement list (the Worker forwards to Neon Auth); to be timed once on the live site by the owner's own sign-up test |
| Gated refusals (`UNAUTHENTICATED`, `ONBOARDING_REQUIRED`) (S14.3, S14.5) | | | | | | Covered by unit tests; no database call on the refusal path |
| Staff CRM overview, pipeline board, CSV export (S14.7) | 2 / 2 / 3 ms | 4 / 3 / 3 ms | 5 / 3 / 6 ms | none | 8 ms | Deploy run 41843245454, 2026-11-04: PASS |
| `/fees` 301 redirect (S14.1) | 0 ms | 0 ms | 0 ms | none | 8 ms | Same run: PASS (the legacy-address row) |

## Owner actions (human, never marked done by Claude Code)

| # | Action | Needed before | Status |
|---|---|---|---|
| R1 | Publish Google's OAuth app, with the Privacy and Terms links from S14.2 | First real onboarding | Open |
| R4 | Real-phone check of the installed icon and launch screen, and a look at the traced logo | Launch | Open |
| R5 | Legal check and text for Privacy, Terms, parent applying for a child, minors, consent | Launch | Open |
| R6 | Trust content for the landing page | Launch | Open |
| R10 | Review the tour video list (S14.6) | Before S14.6 completes | Open |
| R11 | Confirm the CRM metric list (PRD_3 F18) | Before S14.7 | Open |
| H11 | Owner sign-off of the pre-launch checklist | Launch | Open |
| H19 / E5 | Real phone check of the WhatsApp and lead flow, online and offline | Launch | Open |
| H20 | Make the GitHub repository private again | After the measurements | Open |
| Watched test | Three real people use the app (S13.9, now S14.8) | Launch | Open |

The other open carried items (H4, H5, H7, H9, H10, H12, H14, H21, H24, E6, E8) stay as listed in tracker_2.
