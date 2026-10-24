# Essentials 1: Scollarly v2 full build (MVP for PRD_1)

*Amended pre-build on 2026-10-23 by the owner after the engineering review, again on 2026-10-23 after the Stage 0 measurements (owner decisions D13 and D14), and again on 2026-10-24 for the Neon-centred redesign (owner decision D15). See the Amendment logs at the end. Version stays 1.*

## Aim & Outcome

Scollarly connects African students with Indian universities. Version 1 delivers a light, offline-capable public site and PWA, lead intake with smart WhatsApp handoff, student, admin and owner accounts, a database-driven content system with images, lead management with an SLA, analytics, and a ledger of payments received from universities, all on Cloudflare Workers with no paid service unless the owner decides otherwise. This file is the whole build for version 1: every feature F1 to F11 in PRD_1, built in ordered stages. Stage 0 is a hard gate. Nothing after it is built until it passes.

## Source PRD

Source PRD: PRD_1.md

## Source Architecture Components

Source Architecture Version: system_architecture_1.md

Sections of `system_architecture_1.md` built by this file (referenced, not repeated):

- Sections 4 to 6: C4 views, project structure and dependency rules, rendering and caching
- Section 7: data model (7.1 to 7.9)
- Section 8: API structure (8.1 to 8.5)
- Section 9: authentication and authorisation (9.1 to 9.6)
- Section 10: data flows (10.1 to 10.8)
- Section 11: offline and PWA design
- Section 12: performance design
- Section 13: cross-cutting concerns (13.1 to 13.9)
- Section 14: Extensibility & Change-Tolerance
- Section 15: coding methodology and fullstack constraints
- Section 16: page and click map (Parts A, B, C)
- Section 17: Phase 0 gates
- Section 18: decision log (ADR-001 to ADR-028)

## Build Steps

### Working rules for every stage

1. Work on one stage at a time, in order. Do not start a stage until the previous stage's exit criteria pass.
2. Use a feature branch for each module and open a merge request. Never push to `main`.
3. Every module listed has an ID (for example `S3.2`). The tracker records status per module ID.
4. Write tests with the module. A module is complete only when its tests pass in CI.
5. Every migration is additive-first (architecture section 14). No destructive change lands with its replacement.
6. If anything in the architecture or PRD looks wrong or conflicts with what you find, stop and flag it. Do not change the design silently.
7. At the end of each stage, update the tracker with the date, this file's name, the architecture version, and each module's status.

---

### Stage 0: Proof of fit (hard gate)

**Goal:** prove the stack fits Cloudflare Workers Free before anything else is built. Architecture section 17 defines the gates and thresholds. **Status (2026-10-24): Stage 0 is complete. The first slice (2026-10-23) failed several CPU gates and the owner chose to redesign for the free plan (D14, then D15 and D18). Module S0.10 passed every gate on the deployed Worker on 2026-10-24; the results are in the tracker.**

| ID | Module |
|---|---|
| S0.1 | Repo skeleton in the final structure (section 5): pinned Next.js version, OpenNext, Wrangler config, Drizzle config, strict TypeScript, lint, minimal CI, `CLAUDE.md` in place. **First probe:** do the Cache API and cache purge work on the `workers.dev` hostname? Record the answer in the tracker. If they are no-ops, stop and tell the owner that H7 (domain on Cloudflare) is blocking before S0.2, S0.5 and S0.6. **Result 2026-10-23: they work on `workers.dev`, so H7 does not block the cache gates.** |
| S0.2 | A prerendered public page with Lighthouse CI |
| S0.3 | Neon through the serverless driver: one HTTP query, one WebSocket transaction, cold-start measurement. A stub `POST /api/v1/leads` (Zod, Turnstile verify, Durable Object limiter, one insert) so the lead POST CPU gate can be measured. A non-gating probe of whether Neon's API can report CU-hours (info row in the tracker). |
| S0.4 | Auth behind the auth facade on **Neon Auth** (D15): Google sign-in only (no passwords), no session cache (the one session query on every request), owner TOTP 2FA on the otpauth library with recovery codes (Neon Auth has no authenticator-app 2FA), the 10-minute step-up check in our `step_up` table, the `app_user` role and the partial unique owner index. Stub signed-in screens for staff and for students, each a data-free cached shell plus a plain data call (ADR-040, D18), measured on the one-query path used for staff and for students (real Neon Auth sessions of throwaway users, so the whole path is real except the Google round trip). *The first slice used self-hosted Better Auth and also measured email-and-password sign-in with three hash variants (Better Auth default, PBKDF2, magic link); all failed the CPU gate (architecture section 17), and that work is kept only as evidence.* |
| S0.5 | One 300 KB WebP stored in a Neon Object Storage bucket (`images`, public-read; create it with the Neon CLI or console) and served from `/media/[hash]` through the Cache API, with the storage read cost measured on a miss and a hit, and a signed upload tested. The Stage 0 `media_blob` result (about 31 ms on a miss) is kept as evidence. |
| S0.6 | Tag revalidation: a publish updates a public page without a deploy. Name the OpenNext incremental cache and tag-cache bindings used (the read-only static-assets cache cannot revalidate; KV is discouraged) and record whether any of them needs a payment method. If one does, stop and ask the owner (G6). |
| S0.7 | One Cron Trigger run, one Durable Object counter, one Durable Object rate limiter |
| S0.8 | Serwist offline page with a pinned compatible Next.js, bundler and Serwist combination, tested with Playwright offline mode |
| S0.9 | Measurement report recorded in the tracker, one row per gate in architecture section 17 |
| S0.10 | **Free-plan proof (added 2026-10-23, D14; extended 2026-10-24, D15).** Build and measure the redesign on the deployed Worker: (a) the edge fast path in the Worker entry for public pages and images (ADR-033); (b) Neon Auth session verification in the auth facade, measured two ways, the Neon Auth SDK and our own check of the signed cookie, with one query for the `app_user` role (ADR-034, ADR-037); pick by number; (c) the sign-in return trip with a throwaway Google test account on Neon Auth; (d) the staff page query with the row-level-security context set in the same Neon HTTP request, through a non-owner runtime role with `FORCE ROW LEVEL SECURITY` (ADR-038); (e) the lead POST thinned until it meets its gate; (f) a Neon Object Storage image read on a cache miss and a hit, and a signed upload (ADR-039); (g) the stub staff and student screens with a real session, each as two requests, the shell and the data call, with their own gates (ADR-040, D18; the first run failed the staff page rendered by Next.js, 15 ms against 8, and the lead POST tail, so (g) is rebuilt and (e) is diagnosed from per-request samples). Measure each with at least 50 requests and record warm p50 and p95, the worst request, and how many were cut at the limit. Owner prerequisites: Neon Auth switched on with Google credentials (tracker H8, H13) and the Object Storage free-plan limits read (H12). If a gate still fails after reasonable thinning, stop and bring the owner the measured value and the remaining options (D1 back to self-hosted Better Auth, D3 back to Neon `bytea` images, D5 row level security off, a paid plan, or another design). |

**Exit criteria**
- Every gate in architecture section 17 has a recorded measured result. The first slice's results are recorded; Module S0.10 supplies the results for the redesigned gates.
- All Module S0.10 gates pass with no request cut at the CPU limit. Otherwise the decision returns to the owner.
- If any gate fails, stop. Report the failing gate, the measured value, and the options for that gate from architecture section 17 (for example lighter hash, passwordless path, paid plan, fallback in ADR-003; an admin Worker split reduces size only, not CPU per request). The owner decides. Do not continue to Stage 1.
- The owner confirms the commercial-use terms of Cloudflare, Neon, Resend and Turnstile free plans, now also Neon Auth and Neon Object Storage (a human action; record the answer in the tracker). The owner's 2026-10-23 confirmation covered Cloudflare, Neon, Resend and Turnstile. The Neon Auth and Neon Object Storage terms are not yet confirmed (owner action).

---

### Stage 1: Foundation

**Goal:** the full schema, the repository and auth-facade skeleton, shared libraries, and the full CI.

**Architecture:** sections 5, 7, 8.1, 13.3, 13.9, 14, 15.

| ID | Module |
|---|---|
| S1.1 | Migrations for every table in 7.1 to 7.6, all CHECK constraints, indexes (7.8), the owner partial unique index. This includes `lead.intake_kind`, `lead_note`, `lead_claim.verification_method` and `placement_payment.submission_token` (unique). Seed `pipeline_stage` and default `site_setting` values. Every table's migration also adds its row level security policy and enables `FORCE ROW LEVEL SECURITY`, and the migrations run as the owner role while the app connects as the non-owner runtime role (ADR-038). A CI test fails if any table has no policy. |
| S1.2 | Repository layer with the branded `Actor` type. Auth facade interface: `checkSession`, `requireRole`, `requireOwner`. |
| S1.3 | Shared libraries: WAT time helpers, Result type, WhatsApp URL helper (FR-4), phone normaliser (ADR-025), reference generator (ADR-006), error envelope, shared Zod schemas |
| S1.4 | SLA module as a pure function (10.7) with table tests |
| S1.5 | Full CI: Postgres service container, boundary lint rules, Worker size gate (fail above 2.6 MiB compressed), authorisation matrix harness generated from the 9.5 table, Lighthouse CI, axe, CSP in report-only mode, security headers |
| S1.6 | i18n scaffolding: next-intl with namespaces, `messages/en.json` and `fr.json`, rewrites to `/en` (ADR-018), design tokens, system font stack |
| S1.7 | One-off scripts: seed the 9 universities, programmes, fees, FAQs, process steps and copy from the old site data (owner supplies the old repo data files; stop and ask if they are missing), and migrate any existing `ContactSubmission` rows into `lead`. The same script imports the logos and campus images through the `MediaStore` path (WebP, size caps, hash dedupe) so Stage 3 renders real images; a second run changes nothing. |

**Exit criteria**
- Migrations apply to an empty database and fully roll forward in CI.
- Tests prove: fee CHECK (confirmed requires min above 0 and max at least min), testimonial and journey publish CHECK, YouTube ID CHECK, single-owner index, payment void consistency CHECK, `placement_payment.submission_token` uniqueness, and the lead rule (a full lead needs 3 programme preferences; a quick lead needs a university or 1 programme and may have no qualification).
- The seed script run twice leaves the database unchanged the second time, and the 9 university logos exist as `media_asset` rows.
- SLA tests pass for Monday midday, Friday 23:00 WAT (due Saturday 03:00), Saturday and Sunday midnight, and the 24 hours rule.
- A deliberate boundary violation (a Drizzle import outside repositories) fails CI.
- The authorisation matrix harness runs, even if most actions are not yet implemented.

---

### Stage 2: Authentication, roles and the admin shell

**Goal:** F5, FR-7, FR-8, FR-9. All three roles can sign in and see only what they should.

**Architecture:** section 9, section 16 (A9, A10, B0, B11, C0, C1, C2, C5, C6).

| ID | Module |
|---|---|
| S2.1 | Production Neon Auth configuration behind the facade: Google sign-in only, with the one-query session check for page reads (ADR-032, ADR-034, ADR-037). No email adapter exists (Resend is removed, ADR-036). |
| S2.2 | Pages: sign-in with Google and sign-out (A9, A10). There is no sign-up form and no verify, forgot or reset page. A line for students without a Google account (lead intake and WhatsApp still work). Google's redirect address is Neon Auth's, not the `workers.dev` address; confirm this when the credentials are created (tracker H8, F10). |
| S2.3 | Owner bootstrap from `OWNER_EMAIL` on the first Google sign-in with that verified email, the first sign-in creates the `app_user` row idempotently, 2FA enrol and verify (our own code on the otpauth library, with an encrypted secret, 10 hashed recovery codes, a 5-failure lockout and replay refusal), 10-minute step-up in `step_up` (C0, C1, 9.3, ADR-037) |
| S2.4 | `Actor` issuance and role guards. An owner session without 2FA verification has no admin or owner powers. Every signed-in request (shell, data call and mutation) does a fresh session lookup, done by the facade with one query; there is no session cache (ADR-020, ADR-034). Row level security is a second lock under the facade (ADR-038). |
| S2.5 | Admin invites (a copyable link; no email is sent, ADR-036), accept-invite page, Team page with invite, resend, revoke and remove (B0, C2, 9.4) |
| S2.6 | Admin shell: role-based menu, shadcn/ui isolated to admin routes, offline banner, My profile page (B11), Security page (C6) |
| S2.7 | Audit log writer and Audit page (C5) |

**Exit criteria**
- Playwright flows A9, A10, B0, C0, C1, C2 pass.
- Authorisation matrix passes for every action implemented so far.
- A test proves a session is issued only for an email Google reports as verified, and that no password account can be created.
- A test proves a second owner cannot exist and the owner cannot be demoted.
- Row level security: a test connects as the runtime role and is denied on every table without the right user; the CI list of tables equals the list of policies (ADR-038).
- Owner 2FA: enrol, verify, wrong code, clock drift, lockout after 5 failures, single-use recovery codes and refusal of a replayed code are tested.
- Provisioning: two simultaneous first sign-ins create one `app_user` row.
- A test proves a removed admin loses access immediately and their leads return to the unassigned pool.
- No middleware performs access control (grep check in CI).
- A removed admin is refused on their very next request, including a mutation request sent with the old cookie (no cached session).
- An owner session that has not passed 2FA has no admin or owner powers (test). The 10-minute step-up expires and re-prompts (test).
- An invite used with a different email, or after expiry or revocation, is refused (test).
- Sign-in CPU: the real Google callback is run once with the Worker log open and its CPU time is recorded in the tracker. No request is cut at the limit over 50 session-issuing requests (see S0.10).
- Whether Google accepts the `workers.dev` redirect address is recorded. If it does not, the owner is told (the domain, tracker F10).

---

### Stage 3: Public site

**Goal:** F1, F11 structure, FR-1, FR-2, FR-3, FR-16 (public half), G1.

**Architecture:** sections 6, 10.4, 10.5 (delivery half), 12, section 16 (A1 to A4, A6 to A8).

| ID | Module |
|---|---|
| S3.1 | Content read layer and prerender with tag revalidation, and the edge fast path for public pages (ADR-033) |
| S3.2 | Pages: home, universities, university detail, fees, campus tours, process, visa, FAQ, about, blog and post, contact, privacy, terms, offline (A1 to A8). All strings through translation keys. |
| S3.3 | Fee gating (FR-2), thumbnail-first video and tour facade (FR-3), YouTube ID validation, `/media/[hash]` delivery handler reading Neon Object Storage, with its edge fast path (ADR-033, ADR-039) |
| S3.4 | Trust components: stats, testimonials, journeys, team, rendered only when confirmed, verified and consented |
| S3.5 | Performance pass: first load under 200 KB excluding lazy images, public JavaScript within the 100 KB gzip budget, no splash, reduced-motion support |

**Exit criteria**
- With JavaScript disabled, every public page shows its main content (FR-1 test).
- Tests prove a fee never renders as 0 or blank, and unconfirmed fees show the WhatsApp call to action.
- Tests prove no iframe or video loads before a tap, and `youtube-nocookie` is used.
- Instrumented test proves a public page cache hit makes no database query.
- Lighthouse mobile performance at least 85 on every public route. axe passes. Layout works at 375 px.
- Bundle check proves no shadcn or Recharts code in any public route.

---

### Stage 4: Offline, PWA, lead intake and student-side WhatsApp

**Goal:** F2, F3, F4 (student to Scollarly), FR-4, FR-5, FR-6. This is the riskiest user-facing flow, so it is built early.

**Architecture:** sections 10.1, 10.2, 11, section 16 (A5, A1 step 3, A3 step 6).

| ID | Module |
|---|---|
| S4.1 | Serwist service worker, manifest, install prompt, never-cache rules for admin, student, auth and API routes |
| S4.2 | IndexedDB queue and sync engine: backoff, Web Locks, 30-day expiry, delete on success, "Remove from this phone" |
| S4.3 | Full apply form (A5) and the quick WhatsApp form (A5b, ADR-030), lazy Turnstile, and the send-first order: online, wait up to 4 seconds for the server before opening WhatsApp; offline or slow, queue and open WhatsApp; a visible "Open WhatsApp" button if the browser blocks the jump (ADR-031) |
| S4.4 | `POST /api/v1/leads`: idempotency, payload hash, Turnstile verification, layered rate limiting (Durable Object limiter, per-number database limit of 5 per 24 hours), phone normalisation, `received_at` and SLA target, reference collision handling. The handler stays thin enough for its 8 ms CPU gate, checked against the deployed endpoint (S0.10) |
| S4.5 | WhatsApp tap events and `POST /api/v1/events` (collector or the ADR-003 fallback decided in Stage 0). Anonymous events are counts only; a `wa_tap` with a lead ref is stored, at most 10 per ref per day. |
| S4.6 | Contact page and every WhatsApp button reading the number from `site_setting` |

**Exit criteria**
- Playwright (browser offline mode): create a lead offline, go online, exactly one lead exists even with forced retries, a double submit and two tabs open.
- Tests prove the same idempotency key with a different payload returns 409.
- Test proves the lead's `sla_due_at` for a Friday 23:00 WAT receipt is Saturday 03:00 WAT, using server time, not device time.
- Test proves the service worker never caches `/admin`, `/me`, auth pages or `/api`.
- Rate-limit and Turnstile-failure paths return the documented errors.
- Test proves no hardcoded WhatsApp number exists in the code (grep check).
- Playwright, online: Continue saves the lead on the server within 4 seconds and then opens WhatsApp with the reference. Online but slow (over 4 seconds): WhatsApp opens, the lead stays queued, and a later sync gives exactly one lead.
- Tests prove the quick form creates a lead from name, number, country and a page university; a full lead without 3 programmes is refused; a quick lead is not.
- Tests prove `page_view`, `form_start`, `form_submit` and `install` create no Neon rows, and the 11th `wa_tap` for one lead ref in a day is not stored.

---

### Stage 5: Admin lead management

**Goal:** F7, F4 (admin to student), FR-10, FR-11, FR-12.

**Architecture:** sections 7.2, 8.3 (lead actions), 9.5, 10.7, section 16 (B1 to B5).

| ID | Module |
|---|---|
| S5.1 | Leads list with filters, search, URL-based filters (B2) |
| S5.2 | Lead detail: stage change, assign, notes (stored in `lead_note`, with a `note` activity holding only the id), log reply, WhatsApp drawer with stage templates, "Did you send it?" chip (B3) |
| S5.3 | Overdue, Unassigned and Overview pages (B1, B2 tabs). Overview counts come from one SQL statement using `COUNT(*) FILTER`. |
| S5.4 | Duplicate detection query and the merge or dismiss flow, never automatic |
| S5.5 | Link requests (B4) where approval records `verification_method` and is refused without it, data requests and erasure (B5). Erasure runs in one transaction: lead fields, `lead_note` text, `event.lead_ref`. |
| S5.6 | Optimistic concurrency helper on `updated_at` |

**Exit criteria**
- Authorisation matrix passes for all lead actions.
- `lead_activity` has no update or delete path (test).
- First reply logging sets `first_response_at` once and flips the SLA badge to Met.
- Overdue view matches the stored `sla_due_at` and never recalculates.
- Erasure test: the lead is anonymised, aggregates and payment rows remain, the payment's lead link is cleared, `lead_note` text is overwritten, `event.lead_ref` is null for that lead, `lead_activity` is untouched, and a failure halfway leaves nothing half-erased.
- Approving a claim without a verification method is refused (test).
- Playwright flows B1 to B5 pass.

---

### Stage 6: Content management and images

**Goal:** F6, FR-13, FR-14, FR-16 (admin half), FR-18, G3.

**Architecture:** sections 7.3, 7.4, 10.4, 10.5, section 16 (B6 to B8).

| ID | Module |
|---|---|
| S6.1 | The standard content flow as a reusable framework: list, form, draft, publish gates, unpublish, archive, restore, conflict handling |
| S6.2 | Content types: universities, programmes, fees, campus experiences, resources, testimonials with consent records, journeys, team, FAQs, trust stats, process steps, page copy, blog (sanitised Markdown), message templates |
| S6.3 | Media: in-browser resize and WebP conversion, upload action to Neon Object Storage with size caps, file-signature check, SVG rejected, hash deduplication (an existing hash is never overwritten and no delete path exists, D17), media page with usage meter against the 3.5 GB budget, blur step and confirmation for document images |
| S6.4 | Revalidation wired to every publish and unpublish |
| S6.5 | Stale content report as queries on `last_updated_at` and `url_last_checked_at` (fees 180 days, tours 90 days) with "Mark checked". No scheduled flag job. |

**Exit criteria**
- Playwright: an admin edits a university fee and the public page updates with no deploy (FR-16).
- Tests prove the publish gates in both the service and the database: testimonial and journey need verified plus consent, team and trust stats need confirmed, fees need valid ranges.
- Revoking a consent unpublishes dependants (test).
- Image tests: over-cap rejected, SVG rejected, wrong signature rejected, duplicate reuses the stored image, archive blocked while in use.
- Markdown sanitiser test blocks script and raw HTML.
- Concurrent edit shows the conflict message (test).
- Authorisation matrix passes for all content actions.

---

### Stage 7: Analytics (funnel and sources)

**Goal:** F9 (funnel and source parts), G5, the first-party analytics rules.

**Architecture:** sections 7.5, 10.3, 13.2, section 16 (B10).

| ID | Module |
|---|---|
| S7.1 | Collector aggregation (or the Stage 0 fallback), daily rollup into `event_daily_agg` at 23:05 UTC, raw event purge, kill switch. Anonymous events are counts only. |
| S7.2 | Funnel and Sources pages with date, country and university filters, all in WAT, with the limitations notice (B10) |
| S7.3 | "My performance" tab for admins |

**Exit criteria**
- Rollup tests cover WAT date boundaries (an event at 23:30 WAT counts for that WAT date).
- Kill switch test: with `collect_page_views` off, page-view collection stops and the funnel shows a clear notice.
- Test proves events contain no name, number, email or raw IP.
- Funnel numbers reconcile with lead and stage data in an integration test.

---

### Stage 8: Student portal

**Goal:** F8, S6, the data rights in the PRD.

**Architecture:** sections 9.5, 9.6, 10.8, section 16 (A11 to A13).

| ID | Module |
|---|---|
| S8.1 | `/me` progress with stage bar and next step, offline from the IndexedDB `progressSnapshot` (user id, ref, stage, updated_at only; deleted on sign-out and when a different user signs in), WhatsApp to the admin |
| S8.2 | Automatic link for leads created while signed in, and the claim flow with the admin queue from Stage 5 |
| S8.3 | Profile page, self-service data export, and self-service erasure with re-authentication |

**Exit criteria**
- Authorisation matrix proves a student can never read another student's lead.
- A student with no approved claim sees the "matching" state and no lead data.
- Offline test: `/me` shows the last synced stage with its last updated date. After sign-out, or a different user signing in, the snapshot is gone.
- Erasure e2e: leads anonymised, account deleted, signed out, payments kept without the link.

---

### Stage 9: Payments received and admin performance

**Goal:** F10, FR-17, the payments part of F9, the all-admin performance view.

**Architecture:** sections 7.6, 10.6, section 16 (B9, C3).

| ID | Module |
|---|---|
| S9.1 | Ledger repository, record and void actions, double-submit protection through `placement_payment.submission_token`, audit entries |
| S9.2 | Payments page with totals by university and month, record and void flows, CSV export (B9) that prefixes any cell starting with `=`, `+`, `-` or `@` with a single quote |
| S9.3 | Payments totals in analytics |
| S9.4 | All-admin performance page (C3) |

**Exit criteria**
- No update path exists on a payment except voiding (test).
- Voided rows are excluded from totals. A void requires a reason. A future received date is rejected. Amounts are stored as USD cents only.
- A double tap on Save, and a replay of the same submission token, record one payment.
- A CSV cell that starts with `=`, `+`, `-` or `@` is exported with a leading single quote (test).
- Authorisation matrix: admins and owner can record, void and view, others cannot.
- Admin performance: an admin sees only their own, the owner sees all.

---

### Stage 10: Owner pages and operations

**Goal:** settings, health, backup and recovery.

**Architecture:** sections 13.2, 13.7, section 16 (C4, C7).

| ID | Module |
|---|---|
| S10.1 | Settings page with 2FA step-up. Settings consumed everywhere (WhatsApp number, SLA hours, stale thresholds, image budget, page-view switch). |
| S10.2 | Health page, usage checks (database size, image budget, GitHub artifact storage, Neon usage if the Stage 0 API check passed), banners at 70% |
| S10.3 | Owner full export, the weekly encrypted `pg_dump` GitHub Actions workflow (kept 28 days; image bytes are in Neon Object Storage, not in the dump). The monthly images-only artifact is dropped (D17). Instead `scripts/backup-images.mjs` lets the owner copy missing images from the public bucket to their own disk, checked by sha256 against the `media_asset` manifest (no credential, no GitHub storage). Repository secrets, not environment secrets. First confirm the GitHub Free artifact quota in GitHub's own documentation and record it in the tracker. |
| S10.4 | Written recovery procedures in the repo: owner locked out of 2FA, restoring from a dump, restoring missing or corrupt images from the owner's copy |

**Exit criteria**
- Changing the WhatsApp number in Settings updates every WhatsApp link without a deploy.
- A settings change affects only leads received afterwards (SLA test).
- The weekly dump workflow runs against a test database and a restore from the encrypted dump is tested end to end. The images-only dump is restored in a test too. A forced failure of each workflow reaches the owner as a notification.
- The owner export downloads and excludes image bytes.

---

### Stage 11: Hardening and launch readiness

**Goal:** everything needed to go live safely.

**Architecture:** sections 12, 13.1, 13.9, 19, 20, section 16 (all parts).

| ID | Module |
|---|---|
| S11.1 | Enforce CSP (if compatible with Next.js on Workers) and audit all security headers |
| S11.2 | The complete Playwright suite for every click flow in architecture section 16, Parts A, B and C |
| S11.3 | Accessibility, 375 px layout, reduced motion, and Lighthouse on every public route |
| S11.4 | Free-quota review: Worker size, CPU, request estimates, Neon storage and CU-hours, Neon Object Storage usage |
| S11.5 | Traceability table in the tracker: each of FR-1 to FR-18 mapped to at least one passing test |
| S11.6 | Pre-launch checklist with the owner (PRD 12.2): confirmed WhatsApp and contact numbers, confirmed trust content only, legal review status for minors and data protection recorded, Cloudflare DNS, Neon Auth and Google OAuth, vendor terms (no mailbox or Resend DNS: email is removed, ADR-036) |
| S11.7 | Production deploy, owner bootstrap, smoke test of every role |
| S11.8 | Hourly uptime check: a scheduled GitHub Actions workflow calls `/api/v1/health` and fails, so GitHub notifies the owner, when the response is not 200. It checks the Worker, not Neon. |

**Exit criteria**
- Every FR in PRD_1 has a passing test mapped in the tracker.
- No unconfirmed statistic, testimonial or team bio is published.
- The owner signs off the pre-launch checklist. Items that are human actions (legal review, DNS, OAuth) are recorded as done by the owner. Do not mark them done yourself.
- Production smoke test passes for student, admin and owner.
- The uptime workflow has run once against production and a forced failure sends a notification.

---

## Amendment log (pre-build, 2026-10-23)

Edited in place by the owner's instruction after the engineering review. Version stays 1. Nothing had been built or committed. `Source PRD` and `Source Architecture Version` are unchanged.

- Stage 0: Cache API probe first; stub lead POST and stub admin page so those gates are measurable; three hash variants; step-up check; OpenNext cache bindings named; per-gate failure options.
- S1.1, S1.7: new columns and table; logo and image import.
- S2.2, S2.4 and Stage 2 exit: Turnstile and email cap; fresh session lookup for staff; new tests.
- S4.3 to S4.5 and Stage 4 exit: quick form, send-first order, event rules and tests.
- S5.2, S5.3, S5.5 and Stage 5 exit: `lead_note`, claim verification, erasure transaction, single Overview query.
- S6.5, S7.1: no scheduled flag job; counts-only anonymous events.
- S8.1 and Stage 8 exit: `progressSnapshot`.
- S9.1, S9.2 and Stage 9 exit: `submission_token`, CSV formula prefix.
- S10.2, S10.3 and Stage 10 exit: backup contents and retention, artifact quota.
- S11.8 added: hourly uptime check.

## Amendment log (after the Stage 0 measurements, 2026-10-23)

Edited in place by the owner's instruction (D13: edit the existing documents, no new versions). Version stays 1. Cause: the Stage 0 slice was measured on Workers Free and failed the CPU gates; the owner chose to redesign for the free plan (D14).

- Stage 0 gains Module S0.10 (free-plan proof) and a new exit criterion. S0.1 records the Cache API result; S0.4 drops password sign-in.
- Stage 2: Google sign-in only. S2.1, S2.2, S2.3, S2.4, S2.5 changed; the exit criteria for pre-hijack, sign-up and email caps are replaced by a Google-verified-email test, a sign-in CPU check and a record of whether Google accepts a `workers.dev` redirect address.
- Stage 3: S3.1 and S3.3 use the edge fast path. Stage 4: S4.4 carries a CPU check. Stage 11: S11.6 treats Resend and the mailbox as optional.
- The module count in the tracker registry goes from 67 to 68 (S0.10).

## Amendment log (Neon-centred redesign, 2026-10-24, decision D15)

Edited in place by the owner's instruction (D13). Version stays 1. Cause: the owner asked to move authentication, authorisation and images onto Neon after an engineering review.

- Neon Auth replaces self-hosted Better Auth (S0.4, S2.1 to S2.5). Owner 2FA is our own code on the otpauth library. Resend and all email are removed (S2.1, S2.5, S11.6).
- Images move to a Neon Object Storage bucket (S0.5, S3.3, S6.3, S10.3, S11.4). Image backup is decided (D17). R2 was dropped (D16) because its checkout asked for a payment method.
- Row level security with a non-owner runtime role is added (S1.1, S2.4, Stage 2 exit criteria).
- S0.10 is extended with the proofs for all of this and lists the owner prerequisites. The module count stays 68.
- Fixed a mistake from the 2026-10-23 amendment: the S0.9 row had been lost and a stray `$1` was left in front of S0.10. Both are restored.

## Amendment (images in Neon Object Storage, 2026-10-24, decision D16)

R2 is replaced by Neon Object Storage in S0.5, S0.10, S3.3, S6.3, S10.3, S11.4 and S11.6. No other module changes.

## Amendment (image backup, 2026-10-24, decision D17)

S6.3 gains the immutability rule, S10.3 swaps the monthly images artifact for the owner-run copy script, S10.4 gains an image-restore procedure. No module is added.

## Amendment (S0.10 implementation, 2026-10-24)

S0.4 and S2.4: no session cookie cache. S0.10: the lead POST and image reads run in the Worker entry (ADR-033); the Google return trip is measured by hand once, the rest with throwaway Neon Auth sessions created by `scripts/ci/seed-probe-sessions.mjs`.
## Amendment (signed-in screens on the free plan, 2026-10-24, decision D18)

The first S0.10 run failed two gates and the owner chose to stay on the free plan (D18, architecture ADR-040). **From now on, every signed-in screen in Stages 2 and 5 to 11 is a prerendered shell with no data plus data calls, and every signed-in UI mutation is a `POST /api/v1/<area>/<operation>` endpoint, not a Server Action or a server-rendered page.** Each module that builds a signed-in screen builds its data calls and endpoints, unit tests them, and adds a CPU row (shell and data call, at most 8 ms each) to the tracker. Module files are `endpoints.ts`, `service.ts`, `schema.ts`, `components/`. S0.4 and S0.10 are rewritten to measure the new shape. No module is added; the count stays 68.
## Amendment (Stage 2 implementation, 2026-10-24)

Stage 2 was built to this file without a change of scope. Two clarifications: (1) **S2.1** is the existing facade plus the sign-in landing step (`/auth/landing`) and the mutation router; no Neon Auth configuration was changed. (2) **S2.2 sign-up** has no page of its own, and the `/sign-in` button is a plain link to `/auth/start`. Stage 2 exit criteria that need the deployed Worker, CI and a person (the real Google sign-in CPU, the owner's first sign-in, and CI itself) are listed in `docs/stage-2-runbook.md` and are not marked done. Stage 3 does not start until they pass (working rule 1).
