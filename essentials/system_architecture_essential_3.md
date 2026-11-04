# Essentials 3: Scollarly v3 (one stage, for PRD_3)

*Drafted 2026-11-04 from the owner's live-test findings. A new version, not an edit of `system_architecture_essential_2.md`.*

## Aim & Outcome

Make the live app account-first for actions, remove fee information, make the tours real, finish onboarding before any dashboard, add email and password sign-up, publish-ready Privacy and Terms, and turn the staff dashboards into a real CRM with charts. Nothing that works today may break.

## Source PRD

Source PRD: PRD_3.md

## Source Architecture Components

Source Architecture Version: system_architecture_3.md

Built by this file: section 22 (all of it). Rules obeyed, not rebuilt: sections 5 to 11, 13 to 15 of version 1 and section 21 of version 2.

## Build Steps

### Working rules

1. One stage, modules in order; a module starts when the one before has tests passing in CI. S14.1 may start at once; S14.4 starts only after gate G1 is recorded.
2. A feature branch and pull request per module. Never push to `main`.
3. Module IDs (`S14.1`) with status `in-progress` or `complete` in `tracker_2.md` (the tracker continues; entries name this file and architecture 3).
4. Tests with each module. Additive-first migrations. All text through translation keys. No paid service, third-party script, hotlinked image or charting library.
5. Human actions (Google console, legal review, tour video review, owner sign-offs) are recorded only when the owner says so.
6. If a conflict appears, stop and flag.

### Stage 14: Account-first and CRM

**Owner prerequisites:** sign-off of PRD_3, architecture 3 and this file; the `CLAUDE.md` Step 2 change (see tracker flag F28); answers to the open items in PRD_3.

| ID | Module | What is built | Tests |
|---|---|---|---|
| S14.1 | Quick fixes | Link underlines removed on in-text links; "Free for students" removed (en, fr); fee removal per 22.5 (public reads, `/fees` 301, nav, sitemap, offline, Lighthouse, fixtures). | Unit and e2e: no fee text anywhere public; redirect; axe. |
| S14.2 | Privacy and Terms | 22.7 pages in en and fr, footer links, sitemap, Lighthouse. Owner receives the URLs. | e2e presence, content headings, axe, no JS errors. |
| S14.3 | Account-first actions | 22.2: server refusals, `GateDialog`, gate triggers on apply, WhatsApp, contact, finder CTA, `next` allow-list, return after sign-in. | Unit, integration and e2e as 22.9; public bundle check. |
| S14.4 | Email and password | Gate G1 first; then 22.3 routes, forms, labels ("Sign up"). | Integration: no enumeration, lockout; e2e both methods. |
| S14.5 | Onboarding first | 22.4 migration, `Actor.onboardingDone`, refusals, landing table, no-tabs onboarding, "Sign up" button, card removed. | Decision table, refusals, e2e lock. |
| S14.6 | Real tours | 22.6 data, thumbnails, videos found with sources, listing filter, click-to-load player, CSP for the route. Owner reviews the list. | Unit filter, e2e no request before tap. |
| S14.7 | CRM charts, board, filters, export | 22.8 functions, chart components, board, filters, CSV export with audit. | Unit chart maths, integration role scoping and export audit, e2e on phone viewport, new CPU rows. |
| S14.8 | QA, deploy and carry-over | Carries the owner-paced items still open from Stage 13 (S13.7 real-phone icon check, S13.8, S13.9 watched test and sign-offs) and from Stages 10 and 11 (S10.2, S11.4, S11.6), which stay `in-progress` until the owner says they are done. Traceability update, checklist update, CPU measurement run, tracker update. | Full CI; the deploy workflow's CPU rows pass. |

## Tests (summary)

As architecture 3 section 22.9, plus the existing suites staying green.
