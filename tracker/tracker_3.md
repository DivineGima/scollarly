# Tracker 3: Scollarly v3 (Stage 14)

Maintained by Claude Code. Human actions (legal review, DNS, OAuth credentials, Google console, vendor terms, owner sign-off) are recorded here only when the owner says they are done.

This tracker starts version 3 (PRD_3, architecture 3, essentials 3). `tracker_2.md` is the history of Stage 13 (S13.1 to S13.9) and `tracker_1.md` of Stages 0 to 12; both stay in the repository. Where a row below says "see tracker_2" or "see tracker_1", the full text and the evidence are there. Open items are carried here unchanged.

## Current position

| Item | Value |
|---|---|
| Current PRD | `PRD_3.md` (2026-11-04, full copy: part A amendments, part B the whole of PRD_2) |
| Current architecture | `system_architecture_3.md` (2026-11-04, derived from `PRD_3.md`; section 22 wins over older text) |
| Essentials file | `essentials/system_architecture_essential_3.md` (Stage 14, one stage) |
| Phase | Stage 13 modules S13.1 to S13.6 complete; S13.7 to S13.9 built and deployed but `in-progress` (owner-paced items, carried into S14.8). Stage 14 started 2026-11-04. |
| Next module | S14.1 (quick fixes), then S14.2, S14.3, S14.4, S14.5, S14.6, S14.7, S14.8 |
| Blocked by | Nothing blocks S14.1 to S14.3. S14.4 waits for gate G1 (flag F27). |

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
| S14.1 | Quick fixes (fees, underlines, footer text) | in-progress (PR #59) | Session 2 |
| S14.2 | Privacy and Terms | in-progress (PR #60) | Session 2 |
| S14.3 | Account-first actions | in-progress | Session 2 |
| S14.4 | Email and password | in-progress (code done, live switch-on waits for the owner) | Session 2 |
| S14.5 | Onboarding first | not started | |
| S14.6 | Real tours | not started | |
| S14.7 | CRM charts, board, filters, export | not started | |
| S14.8 | QA, deploy and carry-over | not started | |

Carried and still `in-progress` (owner-paced, see tracker_2): S13.7, S13.8, S13.9, S10.2, S11.4, S11.6.

## Session log

### 2026-11-04: Session 2 of tracker_3 (S14.1 to S14.4 built; essentials 3, architecture 3)

Built on branches stacked in order (PR #59 S14.1, PR #60 S14.2, S14.3 and S14.4 next). **S14.1:** fees removed from every public read, page, card and offline copy; `/fees` answers 301 to `/universities`; links are not underlined (line on hover, focus and in long text); footer tagline without "Free for students". **S14.2:** full Privacy policy and Terms of use in English and French. **S14.3:** sign-in pop-up (`GateRuntime`), `GateLink` on Apply and WhatsApp buttons, `RequireAccount` on `/apply`, a `next` allow-list carried through Google sign-in, and the server lock in `POST /api/v1/leads` (401 `UNAUTHENTICATED` without a session, 403 `ACCOUNT_NOT_CONFIRMED`). A signed-in hint on the phone (localStorage, set by the signed-in screens and by the `#signed-in` fragment after sign-in) picks between the real button and the pop-up; it grants nothing. The contact page has no form (only WhatsApp, phone, email and an Apply link); phone and email stay visible as contact information. **S14.4:** `POST /api/auth/sign-up/email` and `/sign-in/email` as Worker functions with validation, rate limit and one fixed error answer; forms on both pages. **Not live yet:** email and password is switched off in Neon Auth (flag F27). Sign-in and sign-up page text "No Google account? You can still apply..." was replaced because it is no longer true.

### 2026-11-04: Session 1 of tracker_3 (setup)

Created this tracker at the owner's request (it had not been created when the v3 documents were merged). The v3 documents are in place (PRs #56 and #57); `CLAUDE.md` Step 2 points to version 3. Next: plan and build S14.1 to S14.4.

## Flags (need the owner)

| # | Flag | Status |
|---|---|---|
| F8 | Branch protection on `main`: the owner chose no GitHub change (2026-11-04); protection is discipline-only. | **Open** (carried) |
| F9, F10 | Domain `scollarly.co.in` and its .IN verification (outside the code). | **Open** (carried, see tracker_2) |
| F22 | Google's OAuth app is in Testing mode with the owner as the only test user. | **Open (owner action R1)** |
| F25 | The onboarding consent text is the placeholder `draft-1`. | **Open (owner action R5)** |
| F27 | Email and password: Neon Auth may force email verification that needs a sender (no paid service allowed). | **Gate G1 checked 2026-11-04: passes.** The Neon Auth project (`aged-recipe-72220939`, production) supports email and password on the plan we use. It is **switched off today** (`email_password.enabled: false`) and verification is not required (`verify_email_on_sign_up: false`), so no email sender is needed. Neon also lists a shared sender (`auth@mail.myneon.app`), but it is for testing, not production. **Owner decision needed before the live switch-on:** (1) turn email and password on in the Neon Auth settings; (2) accept that without verification a person can sign up with an email they do not own. Claude Code does not change the live Neon Auth settings without the owner's word. |
| F28 | `CLAUDE.md` Step 2 pointed at essentials 2. | **Resolved 2026-11-04** (owner said yes). |
| F29 | PRD_3 and architecture 3 were amendment texts. | **Resolved 2026-11-04** (full copies made). |

## CPU rows to record (architecture 22.8, measured by `scripts/measure-cpu.mjs`)

Rows measured for version 2 are in tracker_2 and all passed. New rows for Stage 14 (gate: warm p95 at most 8 ms, none cut):

| Row | Warm p50 | Warm p95 | Worst | Cut | Gate | Run |
|---|---|---|---|---|---|---|
| Password sign-up and sign-in (S14.4) | | | | | | |
| Gated refusals (`UNAUTHENTICATED`, `ONBOARDING_REQUIRED`) (S14.3, S14.5) | | | | | | |
| `GET admin/pipeline`, `GET admin/export.csv` (S14.7) | | | | | | |
| `/fees` 301 redirect (S14.1) | | | | | | |

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
