# System Architecture 3: Scollarly v3 (account-first actions, no fees, real tours, CRM charts)

**Derived From:** PRD_3.md
**Date:** 2026-11-04
**Status:** Drafted 2026-11-04, awaiting owner sign-off. **It is an amendment text:** read it with `system_architecture_2.md` (sections 1 to 21). Section 22 below is new and **wins wherever it disagrees with an older section**. Everything not named in 22.1 still holds.

**Changelog (version 3 against version 2):** added section 22 (gating, password sign-in, onboarding-first routing, fee removal, tours, Privacy and Terms, CRM charts and board, CPU rows, tests, ADR-051 to ADR-058, risks). **Downstream Impact on Essentials:** IMPACT. `system_architecture_essential_3.md` must be a single stage (Stage 14) that builds section 22.

## 22. Version 3 design

### 22.1 What changes and what is superseded

| Older text | Now |
|---|---|
| Google is the only sign-in method (section 2, ADR on auth) | Google plus email and password, only if gate G1 passes (22.3) |
| Public apply, WhatsApp, contact and finder CTA work signed out | Gated (22.2) |
| Onboarding shown as a card above the dashboard | Onboarding is a required route; hubs refuse until it is finished (22.4) |
| Fee ranges on `/fees`, `/universities`, university pages and offline copies | Removed from every public read (22.5) |
| Tours may be "available on request" | Only universities with a video are listed (22.6) |
| CRM: four tiles, one chart, funnel bars | 22.8 |

### 22.2 Account-first actions (ADR-051)

- **Server is the lock.** `POST lead-intake` (apply), the contact submit and any lead-creating function require `Actor.accountConfirmed` and a finished onboarding; otherwise 401 `SIGN_IN_REQUIRED` or 403 `ONBOARDING_REQUIRED`. Authorisation stays in the auth facade, never middleware.
- **No signed-out WhatsApp link.** The one WhatsApp helper gets a `signedIn` argument: signed out, it returns no URL and the caller renders a gate trigger. Public pages are cached and carry no person data, so the server-rendered page contains the **gate trigger** (an anchor to `/sign-in?next=<encoded intent>`), and a small island upgrades it to the pop-up. A signed-in person is detected on the phone from the existing non-secret `scollarly_signed_in` hint cookie (no session data in a cache); the island swaps the trigger for the real WhatsApp or apply link, which is built on the phone from `site_setting` data already in the page. If the hint is wrong, the server still refuses (first bullet).
- **`next` safety.** `next` accepts only the intents `apply`, `chat:<university>`, `contact`, `course:<field>`; anything else is dropped. No open redirect.
- **Pop-up.** One shared client component `GateDialog` (native `<dialog>`, focus trap by the platform, Escape closes, both buttons large). It adds under 1.5 KB gzip; the public ceiling is re-checked in CI.
- **Return.** Sign-in and sign-up carry `next` through the existing intent cookie; `/auth/landing` resolves it after onboarding.

### 22.3 Email and password (ADR-052, gate G1)

- **Gate G1 (decide before building):** confirm in Neon Auth documentation and on the project that (a) email-and-password sign-up is available on the free plan, (b) whether it forces email verification, (c) which sender it uses. If verification needs a paid or unavailable sender, stop and report to the owner (CLAUDE.md: never add a paid service). Result is recorded in the tracker as flag F27.
- Only `server/auth` touches the SDK. New routes `/auth/password/sign-up` and `/auth/password/sign-in` call the facade; the facade returns the same session shape as Google, so `Actor`, row level security and every data function are unchanged.
- No "does this email exist" signal: sign-up with an existing email and a wrong sign-in both return the same generic answer; the existing rate limit and lockout apply. Passwords are never logged or cached.
- Reset is not built (no sender). The page text per PRD_3 F21.

### 22.4 Onboarding first (ADR-053)

- `app_user.onboarding_done_at` (additive; backfilled from existing `student_profile` rows). `Actor.onboardingDone`.
- Student `me` and staff-bound `admin` data calls: a student without it gets 403 `ONBOARDING_REQUIRED`; the shell redirects to `/me/onboarding`. Staff roles are exempt.
- `/auth/landing` decision table gains: unconfirmed none -> sign-in; confirmed and not onboarded -> `/me/onboarding`; onboarded -> `next` or `/me`.
- `/me/onboarding` renders **without** the tab bar and More sheet. Its last button reads "Sign up"; `POST me/onboarding` (unchanged transaction) sets `onboarding_done_at`.
- The onboarding card on the dashboard is removed.

### 22.5 Fee removal (ADR-054)

- Public read layer (`src/modules/content`) stops returning fee fields; the snapshot builder drops them from the public JSON, offline copies and the course catalogue. Stored columns stay (additive-first; nothing dropped).
- `/fees` and its translation keys are removed; `/fees` returns a 301 to `/universities` from the Worker entry (as the legacy redirects do). The nav item, sitemap entry, service-worker precache entry, Lighthouse URL and tests are removed. Cards show no price line. The admin screens may still edit fee data; the labels say it is not shown publicly.
- Tests assert no public HTML or JSON contains a fee amount or "Fees to be confirmed".

### 22.6 Tours (ADR-055)

- Content: `university.tour` gains `{ youtubeId, thumbnailAsset, sourceUrl, checkedAt }` (additive). The thumbnail is copied once into our own storage (no hotlinking).
- `/campus-tours` lists only universities with a tour. The card shows our thumbnail and a "Play tour" button; on tap a small island builds the `youtube-nocookie.com` iframe. No third-party script or request at page load. The Content-Security-Policy allows that frame origin on this route only.
- Finding videos: done by the engineer with the open-web tools, official or public channels only, one record per university with the source; the owner reviews. No video found means the university is not listed on the tours page.
- Offline: the tours page works offline except playing.

### 22.7 Privacy and Terms (ADR-056)

Static public pages from translation keys in English and French, listed in the sitemap and Lighthouse; no JS beyond the shell. Content per PRD_3 F23. Footer links on every public page. The two URLs go to the owner for the Google console. Not marked legally reviewed (R5).

### 22.8 CRM dashboards (ADR-057, ADR-058)

- **Read functions:** `GET admin/home` and `GET admin/insights?view=` extended; new `GET admin/pipeline` (leads by stage, capped page per column with "load more") and `GET admin/export.csv` (filtered leads, staff only, audited, streamed, hard row cap).
- **Charts:** hand-built SVG components in `src/components/admin/charts/` (line, bar, donut, funnel, comparison), each with caption and a table alternative; staff chunk only, never in a public route. No library.
- **Filters:** date range, admin (owner only), country, source; all applied server side in the repository; one query per view.
- **Pipeline board:** columns by stage, a card per lead, a "Move to" control (not drag only), using the existing stage-change function and audit row.
- **CPU rows:** each new function gets a measured row (gate 8 ms warm p95); the export is rate limited and cut at the row cap.

### 22.9 Tests

Unit: `next` allow-list, gate decision, onboarding decision table, fee fields absent, tour filter, chart maths. Integration: server refusals (401, 403 codes), onboarding lock, password sign-in no-enumeration, export audit. Playwright: signed-out gate on every gated action and return after sign-in, onboarding shows no tab bar, no fee text on any public page, tours only with videos, privacy and terms present, axe on all of them, mobile viewport.

### 22.10 ADRs

- **ADR-051** actions need an account; server enforced; gate trigger is a link, the pop-up is an upgrade.
- **ADR-052** email and password through Neon Auth if gate G1 passes; no reset until a free sender exists.
- **ADR-053** onboarding is a route the server enforces, replacing the dashboard card.
- **ADR-054** fees leave public reads; storage is kept; `/fees` redirects.
- **ADR-055** tours use our thumbnail and a click-to-load privacy-enhanced frame; no video, no listing.
- **ADR-056** Privacy and Terms are static translated pages.
- **ADR-057** charts are hand-built SVG, staff chunk only.
- **ADR-058** the pipeline board uses explicit stage controls over the existing audited function.

### 22.11 Risks

- Gate G1 may fail (paid sender needed): password sign-up is then deferred and the owner told.
- A hint cookie out of date shows a trigger to a signed-in person: harmless (one extra click) and the pop-up detects the session.
- Public JS ceiling: the dialog island is small; measured in CI.
- Tour videos may be removed by their owners: `checkedAt` and a link check in the pre-launch list.
- Google may refuse an app named only "Scollarly" without a verified domain (F23): owner action.
- Fee data still in storage until the owner decides to delete.

### 22.12 Page and click map change (Part A3)

Signed-out visitor: any gated button -> pop-up -> Sign in or Sign up -> (new account) onboarding with no tabs -> final "Sign up" -> dashboard -> the action they tapped. `/fees` gone; `/campus-tours` shows videos only; footer shows Privacy and Terms.
