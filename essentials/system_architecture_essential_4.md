# Essentials 4: Scollarly v4 (one stage, for PRD_4)

*Drafted 2026-11-05 from the owner's review of the live v3 app. A new version, not an edit of `system_architecture_essential_3.md`.*

## Aim & Outcome

One path to apply: create account, onboard, apply. Onboarding saves the profile and ends with an "Apply now / Not yet" choice; the application is made from the profile inside the account, once per account; public Apply and WhatsApp buttons become "Create an account"; signed-in students message the team on WhatsApp without retyping anything; a signed-in person sees "My account"; staff see who has not applied yet. The pull request pipeline takes about three to five minutes. Nothing that works today may break.

## Source PRD

Source PRD: PRD_4.md

## Source Architecture Components

Source Architecture Version: system_architecture_4.md

Built by this file: section 23 (all of it). Rules obeyed, not rebuilt: sections 5 to 11, 13 to 15 of version 1, section 21 of version 2 and section 22 of version 3.

## Build Steps

### Working rules

1. One stage, modules in order; a module starts when the one before has tests passing in CI. S15.1 is already built.
2. A feature branch and pull request per module. Never push to `main`.
3. Module IDs (`S15.1`) with status `in-progress` or `complete` in `tracker_4.md` (entries name this file and architecture 4).
4. Tests with each module. Additive-first migrations (one migration, `0019`, in S15.2 and S15.6; nothing is dropped). All text through translation keys. No paid service, third-party script, hotlinked image or charting library.
5. Human actions (Google console, legal review, tour video review, owner sign-offs, the real Turnstile secret) are recorded only when the owner says so.
6. A new CPU row for every new function (gate 8 ms warm p95), measured with the deploy workflow's opt-in measurement before the stage is closed.
7. If a conflict appears, stop and flag.

### Stage 15: One application path

**Owner prerequisites:** sign-off of PRD_4, architecture 4 and this file; the `CLAUDE.md` Step 2 change (see tracker_4 flag F35).

| ID | Module | What is built | Tests |
|---|---|---|---|
| S15.1 | Faster pipeline | Lighthouse measures six pages once on a pull request and every public page once on `main`; the Next build cache in the build, Playwright and Lighthouse jobs. (Merged as PR #75.) | The pull request's own run is timed and recorded in the tracker. |
| S15.2 | Profile-only onboarding | 23.2 migration `0019` function `app_complete_profile` and the staff read policy; `POST me/onboarding` calls it; the "Apply now / Not yet" dialog (23.4). | Integration: no lead made, replay, second device; unit: dialog choices; e2e: onboarding end at phone width. |
| S15.3 | Apply from the account | 23.2 function `app_apply_from_profile`; `POST me/application` and `GET me/application-context` (23.3); `/me/apply` screen; the guard on `POST /leads`; the offline queue entry; the Home Apply and Applied states; the student reminder. | Unit decision table; integration (details from the profile, one lead per account, `already_applied`, number limit); e2e apply with three programmes, a second attempt refused, offline apply. |
| S15.4 | Public pages and WhatsApp | 23.5: "Create an account" links replace Apply and WhatsApp buttons everywhere; the two client islands, `WhatsAppButton`, the apply and chat gate kinds and the public apply page are removed; `GET /apply` forwards; the signed-in WhatsApp button on Home, Progress and Help with the profile message. | Unit: no Apply form or chat link in any public HTML, message builder; e2e: signed-out pages; public bundle check smaller; axe. |
| S15.5 | My account | 23.7: `GET /account`, the `/sign-in` and `/sign-up` forward, the header and footer label swap. | Unit decisions (no cookie, valid, forged); e2e swap with and without the hint. |
| S15.6 | Not applied yet | 23.6: `GET admin/not-applied`, the Leads tab, the Insights numbers and the funnel step. | Integration role scoping and that lead counts do not change; e2e at phone width; axe. |
| S15.7 | QA, deploy and carry-over | Traceability update (PRD_4 requirements FR-33 to FR-38 to tests), checklist update, one deploy with the CPU measurement on and the new rows recorded, tracker update. Carries the owner-paced items still open from Stage 14 (S14.8) and before (S13.7, S13.8, S13.9, S10.2, S11.4, S11.6), which stay `in-progress` until the owner says they are done. | Full CI; the deploy workflow's CPU rows pass. |

## Tests (summary)

As architecture 4 section 23.9, plus the existing suites staying green.
