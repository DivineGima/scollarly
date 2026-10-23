# Tracker 1: Scollarly v2

Maintained by Claude Code. Human actions (legal review, DNS, OAuth credentials, vendor terms, owner sign-off) are recorded here only when the owner says they are done.

## Current position

| Item | Value |
|---|---|
| Current PRD | `PRD_1.md` (amended pre-build 2026-10-23) |
| Current architecture | `system_architecture_1.md` (amended pre-build 2026-10-23) |
| Essentials file for the next stage | `essentials/system_architecture_essential_1.md` (amended pre-build 2026-10-23) |
| Phase | Stage 0 (proof of fit) in progress. The Stage 0 code and the documents were merged to `main` by the owner through PR #1 on 2026-10-23 (merge commit `393affe`), with all CI jobs green. The gates that need a deployed Worker have not been measured. |
| Next stage | Stage 0: Proof of fit (hard gate) |
| Blocked by | The deployed gates need things only the owner can do: a Neon project and connection string, the Worker secrets, and (if the S0.1 probe fails on `workers.dev`) the domain on Cloudflare. Cloudflare is already logged in on the owner's PC. See `docs/stage-0-runbook.md` and Session 4 below. Also open: H1 (vendor terms) and H7 (domain on Cloudflare, needed before the cache gates if the S0.1 probe shows the Cache API is a no-op on `workers.dev`). Stage 1 must not start until every gate has a measured result. |
| Gate before Stage 2 | The owner must decide how email works before Stage 2 starts (see F10 and the Version 2 backlog). Stage 2 modules S2.1 and S2.2 as written need a verified Resend sending domain, which does not exist while the domain is locked. Either the domain is verified, or the documents are amended to version 2 first. Do not start Stage 2 on the current documents otherwise. |

## Session log

### 2026-10-23: Session 1 (read-through and tracker setup, no code written)

**Built against:** essentials `system_architecture_essential_1.md` (the file was first named `system_achitecture_essential_1.md`, a typo the owner corrected the same day), architecture `system_architecture_1.md`, PRD `PRD_1.md`.

**What was done:** read `CLAUDE.md` (then named `claude.md`), `README.md`, `PRD_1.md`, `system_architecture_1.md` (sections 0 to 20 and Appendix A) and the essentials file in full. Ran the start-of-task sequence from `CLAUDE.md`. Created this tracker. No modules were started.

**Start-of-task sequence results**

| Step | Check | Result |
|---|---|---|
| 1 | Read `/tracker/` | Empty, so no stage has started. Begin at essential_1. |
| 2 | Essentials file matches `^system_architecture_essential_\d+\.md$` | Initially **FAIL**: the file was `system_achitecture_essential_1.md` (typo, flag F1). Owner renamed it. Re-checked later on 2026-10-23: `system_architecture_essential_1.md` matches. Pass. |
| 3 | Current architecture version | `system_architecture_1.md` parses cleanly. Current = 1. |
| 4 | Essentials vs architecture drift | `Source Architecture Version: system_architecture_1.md` matches 1. No drift. |
| 5 | Current PRD version | `PRD_1.md`. Current = 1. |
| 6 | Architecture vs PRD drift | `Derived From: PRD_1.md` matches 1. No drift. |
| 7 | Read current PRD | Done. |
| Alignment | Highest N in `/prd/`, `/system_architecture/`, `/essentials/` | All are 1. Essentials cites `PRD_1.md` and `system_architecture_1.md`. Aligned. |
| Source files | `SYSTEM DESIGN RULES.html` and other source files present at repo root | Not in the repository. Owner confirmed on 2026-10-23 that it is a reference only and its contents are already in `CLAUDE.md`. Resolved (F2). |

### 2026-10-23: Session 2 (engineering review and pre-build amendments, no code written)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`. All three were amended in place and stay at version 1.

**What was done:** ran the engineering review (`/plan-eng-review`) on the PRD, architecture, essentials and this tracker. It produced 36 findings (10 architecture, 11 code quality, 14 test gaps, 1 performance) and 11 owner decisions. The owner answered all of them. The four files were then updated. No code was written, no module was started, nothing was committed.

**Start-of-task sequence re-run after the edits:** filename patterns still match (`PRD_1.md`, `system_architecture_1.md`, `system_architecture_essential_1.md`); `Source PRD: PRD_1.md`, `Source Architecture Version: system_architecture_1.md` and `Derived From: PRD_1.md` are unchanged; all three N values are 1. Aligned.

**Owner decisions recorded in this session** (the owner's words are summarised; the full records are in the review plan file)

| ID | Decision | Result |
|---|---|---|
| D2 | How to change documents marked Locked | Edit in place, keep N=1, add a short amendment log to each document. Owner: "just simply edit them ... to make them consistent". |
| D3 | Staff session cache | Admin and owner requests and every Server Action do a fresh session lookup; student `/me` cache at most 60 s. |
| D4 | Quick WhatsApp form | Defined: name, number, country and the page's university; creates a stored lead (`intake_kind = quick`). |
| D5 | Order of save, send and WhatsApp | Send first (wait up to 4 s when online), then open WhatsApp; queue if offline or slow. |
| D6 | Email abuse | Turnstile on sign-up, forgot-password and resend, plus a rate limiter and a student daily cap (60 a day, 3 per address, 40 reserved). |
| D7 | Event writes | Anonymous events are counts only; `wa_tap` with a lead ref is stored, at most 10 per ref per day. |
| D8 | Link claim check | Approval records `verification_method` (`email_match` or `whatsapp_confirmed`). |
| D9 | Erasure and the append-only log | Notes move to a new `lead_note` table; `lead_activity` holds no free text and stays strictly append-only. |
| D10 | Backups | Weekly dump without images (28 days) plus a monthly images-only dump (60 days). |
| D11 | Uptime check | Added as module S11.8, hourly. |

**Corrections made without a question** (factual fixes or required proof of already approved behaviour; the owner can veto any of them): stub admin page and stub lead POST added to Stage 0; Cache API probe on `workers.dev` first; OpenNext cache bindings named; per-gate failure options; cron reduced to rollup, purge and usage checks; `/me` offline snapshot store; physical-delete carve-outs (ADR-029); `submission_token` on payments; logo and image import in S1.7; FR-8 wording aligned to ADR-013; "3 MiB" wording; PRD stage mapping; Neon CU-hours probe; CSV formula prefix; this tracker's own hygiene fixes.

**Module status:** none started. All module IDs are in the registry below with no entry.

### 2026-10-23: Session 3 (Stage 0 implementation, nothing committed)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md` (all N = 1, aligned, start-of-task sequence re-run and passed).

**What was done:** wrote the Stage 0 slice for S0.1 to S0.9 on the local branch `feature/stage-0-proof-of-fit`. No commit, no push, nothing deployed. Module statuses stay `in-progress`: a module is complete only when its tests pass in CI, and CI has not run. Every gate that needs a deployed Worker is still "Not measured" below; no number was invented.

**Verified locally (all green at the end of the session)**

| Check | Result |
|---|---|
| `tsc --noEmit` (strict), `eslint .` | clean |
| Unit tests (`npm test`) | 90 passed, 9 files, includes the import-boundary tests |
| Integration tests (`npm run test:integration`, PGlite locally, Postgres service container in CI) | 36 passed, 3 files: constraints, lead intake, Better Auth flows |
| Playwright offline tests (`npm run test:e2e`, production build) | 6 passed |
| `next build` (Next.js 15.5.28 + next-intl + Serwist) | succeeds |
| OpenNext Worker bundle + `npm run size` | 1.212 MiB compressed |
| Lighthouse CI (3 runs, mobile) | performance 0.79 to 0.84, below the 0.85 gate on this machine (see report) |

**Stage 0 findings (for the owner; none changes the design silently)**

1. **Better Auth 1.7 needs two extra `two_factor` columns** (`failed_verification_count`, `locked_until`, its account lockout). Added; this is the "exact columns confirmed in Phase 0" item of architecture 7.1.
2. **`advanced.ipAddress.disableIpTracking` is not enough to read as "no IP stored"**: Better Auth then writes an empty string, not NULL, to `session.ip_address`. No address is stored (tested); anyone querying that column should treat "" as empty.
3. **Serwist's default `reloadOnOnline: true` reloads the page when the phone reconnects**, which would wipe a half-filled application form. Turned off. The lead queue (S4.2) must handle reconnects without reloading.
4. **A page is cached only once the service worker controls the page.** The first load is uncontrolled and the worker claims the page a moment later, so a visit in those first seconds is not cached until the next navigation. PRD F2 says offline reading works "after one visit". S4.1 must decide how to guarantee it (for example precache the key public pages).
5. **The Next.js App Router baseline is about 104 kB gzip of shared JavaScript with no client components at all.** Architecture 6.3 proposes a 100 KB gzip public JavaScript budget [Mine, confirm], which the framework alone already exceeds. Page weight is fine (108 KiB against the 200 KB budget); the cost shows up as Total Blocking Time. Owner decision needed on the budget (H9).
6. **OpenNext discourages Workers KV as the incremental cache** (eventually consistent, stale pages can persist) and recommends R2 for revalidation. Stage 0 tests KV first because it needs no payment method; if revalidation is unreliable, R2 may need a card (G6, the owner decides).
7. **OpenNext's own `next build` step fails silently on Windows**, and its standalone output misses a manifest file. The Worker bundle was built with a manual workaround. The authoritative build is the Linux CI job; the 1.212 MiB figure should be re-confirmed there.
8. **Probe users exist in the real database** with a verified email and the `admin` role. Their password is derived from the secret `PHASE0_PROBE_TOKEN` (never written in code) and the probe routes answer 404 without it. Remove both after the gates are decided (runbook).

**How to continue:** follow `docs/stage-0-runbook.md`. When the owner commits, split the work into one branch and merge request per module (S0.1 to S0.9).

### 2026-10-23: Session 4 (merge, CI evidence, capability check)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md` (all N = 1, aligned).

**What happened**

- The owner committed Stage 0 as one branch and one pull request (not one per module as the essentials file describes) and **merged PR #1 into `main` at 08:39 UTC** (merge commit `393affe`). Claude Code did not merge: its attempt was stopped by the permission check ("merge without review"), so the owner merged in the GitHub page. Tracker flag F4 (commit nothing until told) is resolved.
- **CI found a real defect and it was fixed before the merge.** The first run failed every job: the lock file written on Windows with npm 11 lacked `@swc/helpers@0.5.23`, so `npm ci` failed on the Linux runner. Fixed by pinning `@swc/helpers` and regenerating the lock with npm 10 (commit `7d104f9`).
- **First Linux CI evidence** (this is what the module tests now show; it is not the deployed measurement):

| Check | Linux CI result |
|---|---|
| Lint, typecheck, unit tests | pass (90 tests) |
| Integration tests on a real Postgres 16 service container | pass (36 tests) |
| Playwright offline tests on a production build | pass (6 tests) |
| Native OpenNext build and Worker size gate | **1.24 MiB compressed** (6.046 MiB raw), pass against 2.6 MiB |
| Lighthouse CI, mobile, 3 runs | passed its assertions: performance at least 0.85 and first load under 200 KB. Exact scores are not printed when an assertion passes. |

**Why module statuses stay `in-progress`:** CI is green, but the Stage 0 exit criteria are the architecture section 17 gates, and the ones that need a deployed Worker are still unmeasured. Stage 1 must not start.

**Capability check (read-only, done this session)**

- Cloudflare: Wrangler and the Cloudflare tool connection are logged in as the owner's account (Workers, KV, D1, Queues, Pages, secrets store, Turnstile widgets, SSL write; zone read). No KV namespace exists yet; there is an unrelated D1 database and Worker named `prob-bot`, which was not touched.
- **`scollarly.co.in` is not a zone in this Cloudflare account** (zero zones). H7 is therefore still open and likely blocking if the Cache API probe fails on `workers.dev`.
- **R2 is not enabled** on the account (Cloudflare answers "Please enable R2 through the Cloudflare Dashboard"). If KV proves unusable for the OpenNext incremental cache, enabling R2 is a dashboard action by the owner and may need a payment method (G6).
- GitHub: Claude Code is logged in with admin rights through the `gh` CLI and the GitHub tool server. **Branch protection on `main` is not available** on this private repository without GitHub Pro (HTTP 403), see flag F8.
- No Neon, Resend or Google Cloud access exists in Claude Code (no logged-in CLI, no connector). These are owner tasks.

### 2026-10-23: Session 5 (domain blocked, owner decision to continue on workers.dev)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md` (all N = 1, aligned). No document was changed in this session; the open question is recorded as a version 2 backlog item below.

**What happened**

- The owner tried to move `scollarly.co.in` to Cloudflare's nameservers (`lana.ns.cloudflare.com`, `yahir.ns.cloudflare.com`) at GoDaddy. GoDaddy refused (`PendingRAAVerification`), and the owner also cannot add or edit DNS records. The owner is an international student in India with no Aadhaar card, so GoDaddy's DigiLocker KYC route is not available.
- Read-only checks by Claude Code: the domain still resolves on GoDaddy's nameservers (`ns43/ns44.domaincontrol.com`), was registered 2026-06-02 and expires 2027-06-02, has no registry hold, and carries `client update prohibited`. So it is locked by the registrar, not suspended. If NIXI (the .IN registry) places it on server hold, it drops out of DNS entirely.
- Sources found: .IN KYC is mandatory for every .in-family domain. For foreign registrants the route is a support ticket, and NIXI reviews a passport plus a statement of connection to India; approval is not guaranteed and NIXI gives no time frame.
- Registry checks on 2026-10-23: `scollarly.com` and `scollarly.org` were **not registered** (authoritative Verisign and PIR answers). Availability and price must still be confirmed at a registrar.
- Claude Code found no legitimate technical workaround. GoDaddy's own nameservers or records do not help: the app needs the domain on Cloudflare, Resend needs records added to the domain's DNS, and the lock blocks both.

**Owner decision D12 (2026-10-23):** keep building on the free `workers.dev` address for now. Record the domain problem as a to-do for the version 2 documents (PRD_2, system_architecture_2, essentials_2). No document is amended today.

**What this means**

- **Stage 0 is not affected** except that the Cache API probe (S0.1) runs on `workers.dev`. If it is a no-op there, the cache gates need the domain (H7) and the architecture 17 fallback applies.
- **Resend.** Without a verified sending domain, Resend delivers only to the email address of the Resend account itself (any other recipient is rejected with a 403). So no student, invite or password-reset email can be sent. Resend is first used in Stage 2, so this is a gate before Stage 2, not a Stage 0 problem.
- The owner is contacting GoDaddy support and NIXI (`support@nixi.in`) about foreign-national KYC. The outcome decides which of the version 2 options below applies.

## Flags (need the owner)

| ID | Flag | Why it matters | Needed from owner |
|---|---|---|---|
| F1 | Essentials filename typo: `system_achitecture_essential_1.md` should be `system_architecture_essential_1.md` to match the pattern in `CLAUDE.md` Step 2. | Under `CLAUDE.md`, a missing essentials file is a halt. | **Resolved 2026-10-23.** Owner renamed the file. Verified: it matches the pattern, cites `system_architecture_1.md` and `PRD_1.md`, and all three N values are 1. |
| F2 | `SYSTEM DESIGN RULES.html` is not in the repository. | `CLAUDE.md` says to halt if a source file is missing. | **Resolved 2026-10-23.** Owner: it is a reference only and its contents are already in `CLAUDE.md`. `CLAUDE.md` is treated as the source of those rules. |
| F3 | `claude.md` was lowercase. Architecture section 5 and S0.1 refer to `CLAUDE.md`. | Linux CI and git treat the two names as different files. | **Resolved 2026-10-23.** Owner renamed it to `CLAUDE.md`. |
| F4 | `prd/`, `system_architecture/`, `essentials/`, `tracker/` and `CLAUDE.md` are untracked in git. | They are the build contract and are not versioned. The pre-build amendments of 2026-10-23 exist only in these files; the originals were not committed. | **Resolved 2026-10-23.** The owner asked for the Stage 0 work and these documents to be committed. They go in through one pull request from `feature/stage-0-proof-of-fit`, not a push to `main`. |
| F5 | `CLAUDE.md` says "No physical deletes in v1. Archive instead." Architecture ADR-029 now names three carve-outs (erasure, raw event purge after rollup, expired auth rows). | The two texts disagree. `CLAUDE.md` is the owner's file and was not edited. | **Open.** Owner decides whether to add the carve-out wording to `CLAUDE.md`. |
| F6 | `src/server/db` (client factory, schema, migrations) imports Drizzle. `CLAUDE.md` says only `server/repositories` may. | Architecture section 5 lists `server/db/` as its own directory beside repositories and calls it part of the data layer, so it was read as the repository layer's internals. The ESLint rule and a source-scan test allow `server/repositories` and `server/db` only. | **Open.** Owner confirms this reading, or the files move under `server/repositories`. |
| F7 | The proposed public JavaScript budget (100 KB gzip) is already exceeded by the Next.js baseline (about 104 kB). | See Session 3, finding 5. Affects the Lighthouse gate and S3.5. | **Open.** Owner chooses: raise the budget, or accept a lower Lighthouse score target. |
| F8 | Architecture 13.8 and `CLAUDE.md` say `main` is protected by a branch protection rule. GitHub refuses to enable it on a private repository on the free plan (HTTP 403, "Upgrade to GitHub Pro or make this repository public"). | Today only discipline stops a push to `main`. Rulesets are also limited on free private repositories. | **Open.** Owner chooses: make the repository public, upgrade to GitHub Pro, or accept discipline-only protection and record it as an accepted risk. |
| F9 | `scollarly.co.in` is not on the Cloudflare account, and R2 is not enabled. | See Session 4. Blocks the domain and cache gates if the `workers.dev` Cache API probe fails (H7). | **Open.** Owner action: add the domain to Cloudflare and change the nameservers at the registrar. R2 only if needed. |
| F10 | `scollarly.co.in` is locked at GoDaddy until .IN KYC is accepted. The owner is an international student without Aadhaar, so DigiLocker is not available. Nameservers and DNS records cannot be changed. | Blocks moving the domain to Cloudflare (H7), a custom domain for the Worker, and the Resend sending domain (H6). The domain still resolves today; a registry server hold would take it offline. | **Open.** Owner action: ask GoDaddy support and email `support@nixi.in` for the foreign-national passport route (message drafted in the conversation). Not marked done by Claude Code. Decision D12: build on `workers.dev` meanwhile. See the Version 2 backlog. |

## Stage status

Allowed status values: `in-progress`, `complete`. A stage or module with no entry has not started, shown as a dash.

| Stage | Name | Module IDs | Status |
|---|---|---|---|
| 0 | Proof of fit (hard gate) | S0.1 to S0.9 | in-progress |
| 1 | Foundation | S1.1 to S1.7 | — |
| 2 | Authentication, roles, admin shell | S2.1 to S2.7 | — |
| 3 | Public site | S3.1 to S3.5 | — |
| 4 | Offline, PWA, lead intake, WhatsApp | S4.1 to S4.6 | — |
| 5 | Admin lead management | S5.1 to S5.6 | — |
| 6 | Content management and images | S6.1 to S6.5 | — |
| 7 | Analytics (funnel and sources) | S7.1 to S7.3 | — |
| 8 | Student portal | S8.1 to S8.3 | — |
| 9 | Payments received and admin performance | S9.1 to S9.4 | — |
| 10 | Owner pages and operations | S10.1 to S10.4 | — |
| 11 | Hardening and launch readiness | S11.1 to S11.8 | — |

## Module registry (67 modules, status per module ID)

Update the status column (`in-progress` or `complete`) at the end of each stage. A dash means no entry yet.

| ID | Module | Status |
|---|---|---|
| S0.1 | Repo skeleton and Cache API probe | in-progress |
| S0.2 | Prerendered public page with Lighthouse CI | in-progress |
| S0.3 | Neon driver, stub lead POST, CU-hours probe | in-progress |
| S0.4 | Better Auth, hash variants, stub admin page, step-up | in-progress |
| S0.5 | 300 KB WebP in `media_blob` served through the Cache API | in-progress |
| S0.6 | Tag revalidation and OpenNext cache bindings | in-progress |
| S0.7 | Cron, Durable Object counter and limiter | in-progress |
| S0.8 | Serwist offline page | in-progress |
| S0.9 | Measurement report | in-progress |
| S1.1 | Migrations, constraints, indexes, seeds | — |
| S1.2 | Repository layer, `Actor`, auth facade interface | — |
| S1.3 | Shared libraries | — |
| S1.4 | SLA pure function | — |
| S1.5 | Full CI | — |
| S1.6 | i18n scaffolding | — |
| S1.7 | Seed and migration scripts, logo and image import | — |
| S2.1 | Production Better Auth configuration, email templates | — |
| S2.2 | Auth pages with Turnstile and email cap | — |
| S2.3 | Owner bootstrap, 2FA, step-up | — |
| S2.4 | `Actor` issuance, role guards, fresh staff session lookup | — |
| S2.5 | Admin invites and Team page | — |
| S2.6 | Admin shell | — |
| S2.7 | Audit log | — |
| S3.1 | Content read layer and prerender | — |
| S3.2 | Public pages | — |
| S3.3 | Fee gating, video facade, media delivery | — |
| S3.4 | Trust components | — |
| S3.5 | Performance pass | — |
| S4.1 | Service worker and manifest | — |
| S4.2 | IndexedDB queue and sync engine | — |
| S4.3 | Apply form, quick form, send-first order | — |
| S4.4 | `POST /api/v1/leads` | — |
| S4.5 | WhatsApp tap events | — |
| S4.6 | Contact page, WhatsApp number from settings | — |
| S5.1 | Leads list | — |
| S5.2 | Lead detail | — |
| S5.3 | Overdue, Unassigned, Overview | — |
| S5.4 | Duplicate detection | — |
| S5.5 | Link requests, data requests, erasure | — |
| S5.6 | Optimistic concurrency helper | — |
| S6.1 | Content flow framework | — |
| S6.2 | Content types | — |
| S6.3 | Media | — |
| S6.4 | Revalidation wiring | — |
| S6.5 | Stale content report | — |
| S7.1 | Collector, rollup, kill switch | — |
| S7.2 | Funnel and Sources pages | — |
| S7.3 | My performance tab | — |
| S8.1 | `/me` progress and offline snapshot | — |
| S8.2 | Automatic link and claim flow | — |
| S8.3 | Profile, export, erasure | — |
| S9.1 | Ledger repository | — |
| S9.2 | Payments page and CSV export | — |
| S9.3 | Payments totals in analytics | — |
| S9.4 | All-admin performance page | — |
| S10.1 | Settings page | — |
| S10.2 | Health page and usage checks | — |
| S10.3 | Owner export and backups | — |
| S10.4 | Recovery procedures | — |
| S11.1 | CSP and security headers | — |
| S11.2 | Complete Playwright suite | — |
| S11.3 | Accessibility and Lighthouse | — |
| S11.4 | Free-quota review | — |
| S11.5 | Traceability table | — |
| S11.6 | Pre-launch checklist | — |
| S11.7 | Production deploy and smoke test | — |
| S11.8 | Hourly uptime check | — |

## Stage 0 measurement report (module S0.9)

One row per gate in architecture section 17. Any failed gate stops the build and goes to the owner with the measured value and the options from section 17.

| Gate | Pass when | Measured | Result |
|---|---|---|---|
| Worker size | At most 2.6 MiB compressed, with auth, Drizzle, next-intl and Zod | 1.24 MiB compressed (6.046 MiB raw) for the Stage 0 slice with Better Auth, Drizzle, Neon driver, next-intl and Zod, from the native Linux CI build (PR #1). The Windows build gave 1.212 MiB | Pass (Linux CI). Re-measure at each stage |
| Public page CPU | Cached public page at most 5 ms per request | | Not measured |
| Password sign-in CPU | At most 10 ms, no Error 1102 over 50 sign-ins. Three variants measured: Better Auth default, PBKDF2 through WebCrypto, passwordless path. | CPU not measured (needs a deployed Worker). Verified locally: all three variants sign in correctly | Not measured |
| Authenticated admin page CPU | At most 8 ms on the fresh session lookup path (staff). The cookie-cache path (student) is recorded too. | CPU not measured (needs a deployed Worker). Pages built; fresh-lookup and cookie-cache paths tested for behaviour | Not measured |
| Lead POST CPU | At most 8 ms (stub endpoint) | | Not measured |
| Image serve (300 KB) | At most 8 ms CPU on a cache miss, no database access on a hit | CPU not measured (needs a deployed Worker). Verified locally: 300 KB bytea round trips byte-exact; a Cache API hit calls no database (unit test) | Not measured |
| Neon cold start | First admin request after idle in about 2 s or less (record the value) | | Not measured |
| Version pinning | Next.js, OpenNext, Serwist and next-intl build, run and pass offline tests | Next.js 15.5.28, OpenNext 1.20.13, Serwist 9.5.13 and next-intl 4.14.9 build and the Playwright offline tests pass 6 of 6 on Linux CI as well as locally. Next.js 16 not evaluated. A run on the deployed Worker is still to do | Pass on Linux CI; deployed run pending |
| Revalidation | A publish updates a public page without a deploy. OpenNext cache bindings named; any payment-method requirement recorded. | | Not measured |
| Cron and Durable Objects | Available on free and working (else ADR-003 fallback and DB rate limit) | Not measured. Scheduled handler and the SQLite-backed Collector and RateLimiter are written and configured | Not measured |
| Better Auth features | Cookie cache, TOTP 2FA with recovery codes, 10-minute step-up, role field, email verification work with the Neon driver | On Postgres (PGlite): TOTP enrol and challenge, recovery code single use, 10-minute step-up and re-confirm, role field, mandatory email verification, fresh versus cached session lookup all pass (36 integration tests). Not yet run over the Neon driver | Pass on Postgres; Neon driver not yet verified |
| Lighthouse | Mobile performance at least 85, first load under 200 KB | Linux CI job passed its assertions (performance at least 0.85, first load under 200 KB; exact scores not printed on a pass). On the owner's slower PC: 0.84 / 0.79 / 0.79 and 108 KiB. Total Blocking Time from the framework runtime is the risk | Pass on Linux CI (home page only). Recheck on the deployed URL and as pages are added |
| Cache API and purge | Work on the production hostname. If they are no-ops on `workers.dev`, H7 becomes blocking before the cache gates. | | Not measured |
| Terms check | Owner confirms commercial-use terms for Cloudflare, Neon, Resend and Turnstile free plans | | Waiting on owner (human action) |
| Info only (non-gating): Neon API CU-hours | Can Neon's API report CU-hours to a cron job? | | Not measured |

## Owner actions (human, never marked done by Claude Code)

Recorded only when the owner says so. Source: PRD section 12.2 and essentials Stage 0, S1.7 and S11.6.

| # | Action | Needed before | Status |
|---|---|---|---|
| H1 | Confirm commercial-use terms of Cloudflare, Neon, Resend and Turnstile free plans. Also decide if any OpenNext cache binding turns out to need a payment method (S0.6). | End of Stage 0 | Open |
| H2 | Supply the old site's data files (9 universities, programmes, fees, FAQs, process steps, copy, logos and campus images) and any `ContactSubmission` rows | S1.7 (Claude Code must stop and ask if missing) | Open |
| H3 | Q2: confirm the Scollarly WhatsApp number (+237 651 232 301 today) and the contact number shown on the site (+91 98157 25968 today) | Launch | Open |
| H4 | Q3: supply real figures for students helped and admitted, confirm the 5 testimonials are real and consented, confirm team bios. Anything unconfirmed is not published. | Launch | Open |
| H5 | Q6: legal check on consent for 17-year-old applicants and data protection in the student countries | Launch | Open |
| H6 | Create a mailbox on scollarly.co.in and verify mail.scollarly.co.in in Resend (DNS records) | Launch, and before Stage 2 (see the gate in Current position) | Open. Blocked by F10 |
| H7 | Confirm scollarly.co.in can point at Cloudflare Workers (likely needs DNS managed in Cloudflare) | Launch, or before S0.2 if the S0.1 probe shows the Cache API is a no-op on `workers.dev` | Open. Blocked by F10 |
| H8 | Create Google OAuth credentials for scollarly.co.in | Stage 2 testing and launch | Open |
| H9 | Confirm every item tagged [Mine, confirm] in the PRD and architecture (SLA/phone/ref defaults, performance budget, image caps and 150 MB budget, step-up window, invite expiry, admin erasure, backup approach, and the values added on 2026-10-23: 4 s send wait, student email cap 60 a day with 40 reserved, 3 per address, 10 `wa_tap` per ref per day, backup retention 28 and 60 days, hourly uptime check) | Before the stage that uses each | Open |
| H10 | Set metric targets and the pipeline freshness "N days" | After 4 weeks of data | Open |
| H11 | Owner sign-off on the pre-launch checklist | S11.6 | Open |

## Version 2 backlog (to-do for PRD_2, system_architecture_2, essentials_2)

Added 2026-10-23 at the owner's request (decision D12). After Stage 0 started, the architecture says any change creates a new version, preceded by a PRD bump with the same number, so these items are done together as N = 2. Nothing below is changed yet. When the version 2 documents are written, each changelog must carry the **Downstream Impact** field that `CLAUDE.md` steps 4 and 6 check (`NO_IMPACT` or `IMPACT`); the email and domain items are `IMPACT` for Stage 2 and Stage 11.

| # | To-do | Documents and modules touched | Depends on |
|---|---|---|---|
| V2-1 | **Settle the production domain.** Either record that `scollarly.co.in` is verified and usable, or replace it with a domain the owner controls (candidates seen unregistered on 2026-10-23: `scollarly.com`, `scollarly.org`; recheck and confirm price at a registrar). Update every place that names the domain. | PRD section 4 ("scollarly.co.in is the only domain"), section 12.2 items 4 to 6; architecture 1, 13.7 and 20; essentials S2.1, S2.2, S11.6, S11.7; H6, H7, H8 | F10: GoDaddy and NIXI outcome |
| V2-2 | **Decide how email works without a verified sending domain**, if the domain is still locked when Stage 2 is due. A possible interim design (owner decision, not yet taken): Google sign-in only for students, admin invites as copyable links sent over WhatsApp, Resend used only for the owner's own address. This would amend F5, FR-7, FR-8, ADR-015 and ADR-027 (the student email cap) and the A9, A10 and B0 page flows. Email and password sign-in and password reset return once a domain is verified. | PRD F5, section 10 (email abuse); architecture 9, 13.1, 16 (A9, A10, B0), ADR-027; essentials S2.1, S2.2, S2.5 | V2-1 |
| V2-3 | **Record the hosting URL decision.** Stage 0 and early stages run on `<worker>.workers.dev`. Record the Cache API probe result there, which fallback from architecture 17 was used (edge cache with `s-maxage` needs the custom domain), and that a real domain is required before launch. | Architecture 6.1, 17, ADR-002; essentials S0.1, S0.6, S11.7 | S0.1 probe result |
| V2-4 | **Re-check Google OAuth on `workers.dev`.** Whether Google accepts a `workers.dev` redirect URI for the consent screen is not verified here. Test it in Stage 2; if refused, it is a second reason to settle V2-1 first. | Architecture 9; H8 | Stage 2 |
| V2-5 | **Fold in the other open flags if the owner agrees:** F5 (physical-delete carve-outs in `CLAUDE.md`), F6 (`server/db` may import Drizzle), F7 (public JavaScript budget), F8 (branch protection on a private free repository). | `CLAUDE.md`, architecture 5, 6.3, 13.8, ADR-014, ADR-029 | Owner answers |

## Project understanding (for future sessions)

- **Product:** Scollarly connects African students (Cameroon, Nigeria, Ghana, Ivory Coast, Senegal, Guinea, South Africa) with Indian universities. Students pay nothing. Universities pay Scollarly in USD after enrolment. Version 2 is a brand-new codebase replacing an old site built for good connections.
- **Core problem:** users are on limited, expensive Android data. The old site was heavy, hotlinked images, had no lead storage, no admin, hard-coded content and inconsistent trust claims.
- **Roles:** exactly three: student, admin, owner. One owner, enforced by a partial unique index. Owner powers require a 2FA-verified session. Admin and owner requests do a fresh session lookup, so removal cuts access on the next request.
- **Scope:** all features F1 to F11 ship in version 1 (public site, PWA with offline lead queue, lead intake with a full form and a quick WhatsApp form, smart WhatsApp links, auth and roles, content management with images in Neon, lead management with SLA, student portal, analytics, payments-received ledger, i18n scaffolding with English live and French ready).
- **Lead flow:** the form saves locally, sends, waits up to 4 seconds when online, then opens WhatsApp with the reference. Offline or slow, it queues and opens WhatsApp anyway.
- **Stack:** Next.js (App Router) and TypeScript on Cloudflare Workers via OpenNext, Neon Postgres with Drizzle, Better Auth, Resend, Turnstile, Serwist and idb, next-intl, Tailwind, shadcn/ui and Recharts (admin only), Vitest, Playwright, Lighthouse CI, axe, GitHub Actions. Free tiers only. No paid service and no change of host without the owner.
- **Biggest risks:** Workers Free limits (10 ms CPU, 3 MiB size) against Next.js, auth hashing and images (Cloudflare puts auth and server rendering at 10 to 20 ms, so the 8 ms admin gate is the likeliest to fail); Neon scale-to-zero and 100 CU-hours; offline queue interacting with Turnstile; Serwist and Next.js version compatibility; caching behaviour that may need the real domain. This is why Stage 0 is a hard gate.
- **Hard rules:** never push to `main`; feature branch and merge request for every change; only `server/repositories` imports Drizzle, only `server/auth` imports Better Auth, only `server/email` imports Resend; no access control in middleware; no admin libraries in public routes; one WhatsApp URL helper; no physical deletes of business or content data (carve-outs in ADR-029); no personal data in logs or events; UTC in storage, WAT (`Africa/Douala`) for display; additive-first migrations; unconfirmed stats, testimonials and bios are never published.
- **Build order:** Stage 0 proof of fit, then Foundation, Auth and admin shell, Public site, Offline and lead intake, Lead management, Content and images, Analytics, Student portal, Payments, Owner pages, Hardening and launch.

## Traceability (to be filled at S11.5)

Each of FR-1 to FR-18 must map to at least one passing test before launch. Not started.
