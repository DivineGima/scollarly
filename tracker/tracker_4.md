# Tracker 4: Scollarly v4 (Stage 15)

Maintained by Claude Code. Human actions (legal review, DNS, OAuth credentials, Google console, vendor terms, owner sign-off) are recorded here only when the owner says they are done.

This tracker starts version 4 (PRD_4, architecture 4, essentials 4). `tracker_3.md` is the history of Stage 14, `tracker_2.md` of Stage 13 and `tracker_1.md` of Stages 0 to 12; all stay in the repository. Where a row below says "see tracker_3", "see tracker_2" or "see tracker_1", the full text and the evidence are there. Open items are carried here unchanged.

## Current position

| Item | Value |
|---|---|
| Current PRD | `PRD_4.md` (2026-11-05, full copy: part A amendments, part B the whole of PRD_3) |
| Current architecture | `system_architecture_4.md` (2026-11-05, derived from `PRD_4.md`; section 23 wins over older text) |
| Essentials file | `essentials/system_architecture_essential_4.md` (Stage 15, one stage) |
| Phase | Stage 14 built, merged and deployed (see tracker_3); its owner-paced items are carried into S15.7. **Stage 15 documents written 2026-11-05 (PRD_4, architecture 4, essentials 4), awaiting the owner's sign-off.** S15.1 (faster pipeline) is complete and merged (PR #75). |
| Next module | S15.2 once the owner signs off the documents. |
| Blocked by | The owner's sign-off of PRD_4, architecture 4 and essentials 4. |

## Start-of-task check results (CLAUDE.md steps 1 to 7), 2026-11-05

| Step | Result |
|---|---|
| 2 essentials file | `system_architecture_essential_4.md` exists; `CLAUDE.md` Step 2 (owner decision 2026-11-05, flag F35) selects it while Stage 15 is incomplete |
| 3 architecture version | highest `system_architecture_N.md` is 4 |
| 4 essentials vs architecture | essentials 4 cites `system_architecture_4.md`: match |
| 5 PRD version | highest `PRD_N.md` is 4 |
| 6 architecture vs PRD | architecture 4 says `Derived From: PRD_4.md`: match |
| Version alignment | PRD 4, architecture 4, essentials 4: same N, each cites its own N |

## Standing owner check-ins

| # | Check | Link | Status |
|---|---|---|---|
| C1 | Has Neon Auth shipped authenticator-app 2FA (MFA/TOTP)? | https://neon.com/docs/auth/roadmap | **Paused by the owner (2026-10-24).** Do not ask again until about 2026-11-24. |

## Module registry (Stage 15)

| ID | Module | Status | Last session |
|---|---|---|---|
| S15.1 | Faster pipeline | complete: merged as PR #75. Its own run (which changed the Lighthouse config, so Lighthouse ran) finished in 3 min 49 s at the slowest job (Lighthouse 3 min 31 s, Playwright 3 min 49 s and 2 min 35 s, build 2 min 39 s, integration 2 min 16 s, lint and unit 2 min 1 s), against about 12 minutes before. A documents-only pull request skips Lighthouse. | Session 1 |
| S15.2 | Profile-only onboarding | complete, merged as PR #79, CI green (migration 0019 `app_complete_profile`; onboarding saves the profile only and ends with the Apply now / Not yet choice). Local: typecheck, 1026 unit, 16 integration (s13-3), s13-4 and s13-5 integration, 14 browser tests pass. | Session 2 |
| S15.3 | Apply from the account | in review (migration 0020 `app_apply_from_profile` and `app_token_has_application`; `POST me/application`, `GET me/application-context`; the `/me/apply` screen; the Home Apply button; the guard on the older lead endpoint; the offline `application` item). Local: typecheck, unit (s15-3), 16 integration tests pass. | Session 2 |
| S15.4 | Public pages and WhatsApp | not started | |
| S15.5 | My account | not started | |
| S15.6 | Not applied yet | not started | |
| S15.7 | QA, deploy and carry-over | not started | |

Carried and still `in-progress` (owner-paced, see tracker_3 and tracker_2): S14.8 (owner items), S13.7, S13.8, S13.9, S10.2, S11.4, S11.6.

## Session log

### 2026-11-05: Session 1 (decisions and documents)

Built against: no essentials file yet (the documents were being written). The owner reviewed the live v3 app and decided: the header shows "My account" for a signed-in person; a student with an application is blocked from applying again, with a message; adding another course is not offered; onboarding creates the profile only and ends with an "Apply now / Not yet" choice; Apply lives in the dashboard and is filled from the profile; admins see a "Not applied yet" list; public Apply and WhatsApp buttons become "Create an account"; WhatsApp moves into the signed-in area for any student who finished onboarding, applied or not, and asks for nothing; the same for parents; offline apply queues. A read of the code found five paths that create a lead (onboarding, the public apply form, the quick WhatsApp form on every chat button, the finder, link-my-application), which is the drift the owner asked to remove. PRD_4, `system_architecture_4.md`, essentials 4 and this tracker were written, and `CLAUDE.md` Step 2 was amended (flag F35). The pull request pipeline was shortened in PR #75 (Lighthouse once, six pages on a pull request, every page once on `main`; Next build cache). No application code changed.

## Flags (need the owner)

| # | Flag | Status |
|---|---|---|
| F8 | Branch protection on `main`: the owner chose no GitHub change (2026-11-04); protection is discipline-only. | **Open** (carried) |
| F9, F10 | Domain `scollarly.co.in` and its .IN verification (outside the code). | **Open** (carried, see tracker_2) |
| F22 | Google's OAuth app is in Testing mode with the owner as the only test user. | **Open (owner action R1)**. The owner said on 2026-11-04 that the Google publish is done; it is recorded here only when the owner says "record it". |
| F25 | The onboarding consent text is the placeholder `draft-1`. The apply step reuses it. | **Open (owner action R5)** |
| F30 | Staff and password logins. | **Repaired 2026-11-04** (migration 0018); residual accepted, see tracker_3. |
| F33 | The image CPU rows are intermittent. | **Open** (carried, see tracker_3). |
| F34 | The deploy uses Cloudflare's always-pass Turnstile secret until the repository secret `TURNSTILE_SECRET_KEY` is added. | **Open, owner action** (carried). Note: after S15.4 no public lead form remains, so the secret matters only for the contact form and until `POST /leads` is retired. |
| F35 | `CLAUDE.md` Step 2 pointed at essentials 3. | **Resolved 2026-11-05** by the owner decision recorded in `CLAUDE.md` (the owner asked for the version 4 documents). |
| D3 | The 360 tour card for Chandigarh and Kalinga repeats the video picture. | **Open, owner choice** (carried). |

## CPU rows to record (architecture 23.8, measured by `scripts/measure-cpu.mjs`)

Gate: warm p95 at most 8 ms, none cut.

| Row | Warm p50 | Warm p95 | Worst | Cut | Gate | Run |
|---|---|---|---|---|---|---|
| `POST me/application` (create, replay) (S15.3) | | | | | | Not run yet |
| `GET me/application-context` (S15.3) | | | | | | Not run yet |
| `GET admin/not-applied` (S15.6) | | | | | | Not run yet |
| `GET /account` and `GET /sign-in` with a session (S15.5) | | | | | | Not run yet |

## Owner actions (human, never marked done by Claude Code)

| # | Action | Needed before | Status |
|---|---|---|---|
| Sign-off | PRD_4, architecture 4, essentials 4 | S15.2 starts | Open |
| R1 | Publish Google's OAuth app, with the Privacy and Terms links | First real onboarding | Open (the owner reported it done; waits for "record it") |
| R4 | Real-phone check of the installed icon and launch screen | Launch | Open |
| R5 | Legal check and text for Privacy, Terms, parent applying for a child, minors, consent | Launch | Open |
| R6 | Trust content for the landing page | Launch | Open |
| H11 | Owner sign-off of the pre-launch checklist | Launch | Open |
| H19 / E5 | Real phone check of the WhatsApp and lead flow, online and offline | Launch | Open |
| H20 | Make the GitHub repository private again | After the measurements | Open |
| Watched test | Three real people use the app (S13.9, S14.8) | Launch | Open |

The other open carried items (H4, H5, H7, H9, H10, H12, H14, H21, H24, E6, E8) stay as listed in tracker_2.
