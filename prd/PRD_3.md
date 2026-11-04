# PRD 3: Scollarly v3 (account-first actions, no fees, real tours, CRM charts)

**Status:** Version 3, drafted 2026-11-04 from the owner's findings while testing the live v2 app. **It is an amendment text, not a full copy:** read it together with `PRD_2.md`. Wherever the two disagree, **PRD_3 wins**; everything in `PRD_2.md` that is not named in the "Supersedes" list below still holds. (Flag for the owner: PRD_2 was a complete copy of PRD_1. A full copy of PRD_2 would be about 600 lines of unchanged text; the owner may ask for one later.)
**Date:** 2026-11-04
**Basis:** `PRD_2.md`, the live app as built through Stage 13 modules S13.1 to S13.9, and the owner's test notes of 2026-11-04.

## Changelog (PRD_3 against PRD_2)

- **Added:** F20 account-first actions, F21 email and password sign-up, F22 real tours, F23 Privacy and Terms for Google publishing.
- **Changed:** F15 onboarding order (dashboard only after the questions), F18 CRM dashboards (real charts, more metrics, pipeline board, filters, export), F14 (the onboarding button reads "Sign up"), F13 landing page (footer text).
- **Removed:** F3-style fee ranges and the Fees page, the "Fees to be confirmed" text, "Free for students" text, link underlines on in-text links, the "available on request" tour state.
- **Unchanged:** the three roles, the free-plan CPU design, offline rules, WAT, zero recurring cost, light brand, and every rule in `CLAUDE.md`.
- **Downstream Impact:** IMPACT. `system_architecture_3.md` must add the gating design, password sign-in, onboarding-first routing, fee removal, the tour data and player, the Privacy and Terms content and the CRM chart set, and `system_architecture_essential_3.md` must build them.

Tags as in PRD_2: **[Owner, v3 2026-11-04]** the owner decided it; **[Mine, v3]** needed to make it coherent, the owner confirms or overrules; **[Open]** unresolved.

## Supersedes (what in PRD_2 no longer holds)

| PRD_2 text | Now |
|---|---|
| "Google-only sign-in" (section 1 and F14) | Google **and** email with password [Owner, v3] |
| F3 and S2, S3: fee ranges, "contact us" where fees are unconfirmed | No fee information anywhere public [Owner, v3] |
| Apply and WhatsApp open to a signed-out visitor (F4, F5, S4) | Need an account (F20) |
| F15 "dashboard first, onboarding card on top" as built | Onboarding first, dashboard only after (F15 amended) |
| F18 "four tiles, one chart, funnel bars" | F18 amended below |
| F8 tours "available on request" and "Ask about this university on WhatsApp" | F22 |
| Footer "Free for students" | Removed [Owner, v3] |

## F20 Account-first actions [Owner, v3 2026-11-04]

Public information stays public: a visitor can read the landing page, universities, blog, FAQ, visa, process, about and tour information without an account. **Any action needs an account.** Actions are: start an application (`/apply` and every Apply button), start a WhatsApp chat (every WhatsApp button, including tour and finder buttons), send the contact form, and the course finder's "start application" link.

- A signed-out person who taps an action sees a pop-up "Sign in or create an account" with both buttons. After signing in or signing up (and onboarding, for a new account) they are returned to the action they tapped. [Owner, v3; return rule Mine, v3]
- A signed-in person with a finished onboarding goes straight to the action. A signed-in person who has not finished onboarding goes to onboarding first.
- The rule is enforced on the server too: a request that creates a lead, application or contact message without a confirmed session is refused. A hidden or edited button must not bypass it. [Mine, v3]
- WhatsApp links for a signed-in person may still include their details already; for a signed-out person no WhatsApp link is ever shown, only the pop-up trigger. [Mine, v3]
- Without JavaScript the gated buttons are links to `/sign-in?next=<action>`, so the page still works. [Mine, v3]
- Offline queued submissions already belong to signed-in users; unchanged.

## F21 Email and password sign-up [Owner, v3 2026-11-04]

Sign in and Sign up offer **Google** and **email with password**. The owner chose email and password because it sends no email and costs nothing. [Owner, v3]

- Password rules, lockout and rate limits follow the existing sign-in protection; no "does this email exist" signal (the F14 rule stays). [Mine, v3]
- A password reset needs email sending, which is not available (Resend removed). Until a free sender exists, reset is **not offered**; the sign-in page tells a person who lost their password to use Google with the same email if it is a Google address, otherwise to contact the team through the contact details on the Contact page. [Open: owner decides whether to offer a reset later]
- Whether email verification is required depends on what Neon Auth supports without a paid sender; this is a Phase 0 style gate in the architecture (the owner is told the result before building on it). [Mine, v3]
- The onboarding screen's final button reads **"Sign up"**; the old "Create account" label on sign-up becomes "Sign up". [Owner, v3]

## F15 amended: onboarding before dashboard [Owner, v3 2026-11-04]

A new account (Google or email) goes **straight to onboarding** and sees no hub, tab bar, More sheet or dashboard until the last question is answered and the final "Sign up" button is pressed. Finishing creates the lead and profile as in PRD_2 and opens the personalised dashboard. Leaving halfway returns to the same step next time (draft kept). The earlier build that showed the dashboard with an onboarding card on top is replaced. Skipping is not offered. [Owner, v3]

## F22 Real campus tours [Owner, v3 2026-11-04]

- Every university listed on `/campus-tours` shows a **real tour video**. A university with no video found is **not listed** on the tours page; there is no "available on request" and no "Ask about this university on WhatsApp" fallback. [Owner, v3]
- Each tour shows a preview image from our own storage and plays only after a tap (the player loads then, not before), so no third-party script loads on page load and no data is used unasked (S8). [Owner, v3; mechanism Mine, v3]
- Videos are found on the open web from official university or public channels, each with its source URL recorded in the content record so the owner can check or remove it. The owner reviews the list before launch. [Mine, v3]
- A university with no tour is still listed on `/universities`.

## F23 Privacy and Terms [Owner, v3 2026-11-04]

`/privacy` and `/terms` are complete, public, in English and French, with no sign-in needed, so they can be pasted into the Google Cloud console and the app published.

- The page names the service as "Scollarly" and gives `gimafolabit@gmail.com` for requests. [Owner, v3]
- Privacy covers: what is collected (name, email, Google profile basics, onboarding answers, messages), why, who sees it (the Scollarly team only), how Google data is used and that it is not sold or shared, retention and deletion on request, the Cookie and storage use, children and parents, and how to complain. No raw IP storage. [Mine, v3]
- Terms covers: the service is free to students, the team is an adviser and not a university, no guarantee of admission, accounts and conduct, content accuracy, changes, and contact. [Mine, v3]
- **[Open, owner action]** Google may require a legal owner name or a verified domain on the consent screen. The owner decides and does the console steps. These pages are not legal advice and are not marked reviewed until the owner says so (R5).

## F18 amended: CRM dashboards [Owner, v3 2026-11-04]

The owner expects a real CRM, with graphs and charts. The staff area gains:

- **Charts:** line (leads over time), bar (leads by country, by source), donut (stage split), funnel, and per-admin comparison. Hand-built SVG, no charting library (an existing rule), each with a one-sentence caption and a text alternative.
- **More metrics:** new leads, qualified, applied, enrolled, conversion rate between stages, average first-response time, overdue count, leads by source, payments by month, and each compared with the last period.
- **Pipeline board:** leads in columns by stage; a stage change by one tap on the card (not drag only). The existing stage-change rules and audit apply.
- **Filters and export:** date range, admin, country and source filters, and a CSV export of the filtered leads (staff only; personal data rules apply; the export is audited). [Mine, v3: exact metric list; owner confirms]
- Roles are unchanged: the owner sees everyone, an admin sees their own leads.

## Non-functional notes [Mine, v3]

- Public JS ceiling (118 KB gzip) and the CPU gate (8 ms warm p95) still apply. The sign-in pop-up must be small; chart code lives only in the staff area.
- Password handling stays inside `server/auth`; no password, hash or token appears in a log, a cache or an event.
- Removing fees is a visibility change first: fee columns are hidden from every public read and may stay in storage for the admin (additive-first; nothing dropped). The owner may later ask for deletion.

## Open items for the owner

1. Email verification and password reset: accepted limits (see F21).
2. Legal owner name and domain for Google publishing (F23, R1, R5).
3. Review of the tour video list before launch (F22).
4. Confirm the CRM metric list (F18).
5. Confirm the version approach: PRD_3 is a delta text, not a full copy.
