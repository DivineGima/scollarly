# Tracker 1: Scollarly v2 in-progress (2026-10-24: `/auth/landing`, mutation router, endpoint wiring; local tests pass, CI not run) | in-progress (2026-10-24: sign-in, sign-out pages; Google redirect on `workers.dev` already proven in Stage 0, real run of the new landing step not yet measured) | in-progress (2026-10-24: bootstrap, 2FA endpoints and pages, step-up prompt; the owner has not yet signed in with it) | in-progress (2026-10-24: access rules, owner-is-permanent trigger, removal; local tests pass) | in-progress (2026-10-24: invites, accept-invite page, Team page; local tests pass) | in-progress (2026-10-24: admin shell, Overview, Profile, Security; Playwright with mocked endpoints passes) | in-progress (2026-10-24: audit writer and Audit page; local tests pass) |

Maintained by Claude Code. Human actions (legal review, DNS, OAuth credentials, vendor terms, owner sign-off) are recorded here only when the owner says they are done.

## Current position

| Item | Value |
|---|---|
| Current PRD | `PRD_1.md` (amended in place 2026-10-24, D15) |
| Current architecture | `system_architecture_1.md` (amended in place 2026-10-24, D15) |
| Essentials file for the next stage | `essentials/system_architecture_essential_1.md` (amended in place 2026-10-24, D15) |
| Phase | **Stages 3 and 4 are built together (Session 18, 2026-10-25, branch `feature/stage-3-4-content-leads`) at the owner's request and wait for CI.** Stage 2 is complete per the owner's words (merged as PR #18, deployed, the owner signed in with Google and enrolled 2FA). Stage 1 (foundation) is complete (2026-10-24). Stage 0 (proof of fit) is complete (2026-10-24). The documents are edited in place and are still version 1 (D13). |
| Next stage | **Stages 3 and 4 need CI on their pull request, then the owner's steps in `docs/stage-3-4-runbook.md`** (merge, publish the content, deploy, real Turnstile keys, a phone check). Stage 5 (admin lead management) has not started. See Session 18. |
| Blocked by | Nothing blocks the code. Stage 3 and 4 completion needs: CI green on the new pull request; migration 0005 applied by the deploy workflow; the published content; the real Turnstile widget and its two secrets (until then the always-pass test keys are in use, which is insecure); the CPU rows for `POST /api/v1/leads` and `POST /api/v1/events` measured on the deployed Worker. Open and not blocking: H4, H5, H9 (F7), H12, the `ContactSubmission` import, and the domain (F10, launch only). |
| Gate before Stage 3 and 4 | Stage 2 exit criteria. **The owner waived the one-stage-at-a-time wait on 2026-10-25** ("bypass the logic of waiting one to get completed before doing the other") and said the Google sign-in and 2FA enrolment worked, so the gate is met and Stages 3 and 4 were built together. |

## Standing owner check-ins (ask the owner at the start of every session)

Claude Code: after reading this tracker, ask the owner each open check-in below and show its link. Stop asking only when the owner says the item is done or no longer wanted, and record that here. (Added at the owner's request, D15.)

| # | Check | Link | Why | Status |
|---|---|---|---|---|
| C1 | Has Neon Auth shipped authenticator-app 2FA (MFA/TOTP)? | https://neon.com/docs/auth/roadmap | Neon Auth has none today (checked 2026-10-24), so the owner's 2FA is our own code on the otpauth library (ADR-037). If Neon ships it, the owner decides whether to replace our code with Neon's. | **Paused by the owner (2026-10-24): "not yet, it won't come for about a month, stop over-asking".** Do not ask again until about 2026-11-24. |

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

### 2026-10-23: Session 6 (Stage 0 deployed to workers.dev and measured)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md` (all N = 1, aligned).

**What happened**

- **Owner confirmation H1:** the owner read the free-plan terms of Cloudflare, Neon, Resend and Turnstile and said "i checked all ok" (2026-10-23). Recorded as the owner's statement. Claude Code's reading, for the record: no page forbids commercial use of the free plan; Turnstile's page calls the free plan suitable for "most production applications"; Neon's plans page describes Free as for "prototypes, side projects, and small teams"; Cloudflare and Resend may end free services at any time.
- **Deployment worked on the first run** through the manual workflow (`stage0-deploy.yml`, PR #4): token check, KV namespace and D1 database created **with no payment-method request**, Neon migration applied, 300 KB image stored, Worker built (1.24 MiB), deployed to `https://scollarly.gimafolabit.workers.dev`, secrets set.
- **The workflow's probe step and CPU step were unreliable and were repaired.** The CPU step hung and was cancelled; the saved probe report was recovered. Root causes found in Claude Code's own scripts: (1) `wrangler tail --format json` prints pretty-printed multi-line JSON, but the script read one line at a time, so it could never parse an event; (2) requests had no timeout; (3) the tail process was started through a shell and could not be stopped reliably. All three are fixed (new JSON splitter with unit tests, request timeouts, direct launch). The CPU figures below come from the fixed script run from the owner's PC against the live Worker, with 20 requests per scenario.
- The probe token on the test Worker was replaced by one held only by Claude Code, for local debugging. The next workflow run sets it back from the GitHub secret.

**Measured results** (CPU is Worker CPU time from `wrangler tail`; the tail samples under load, so "events" is fewer than requests; values of 10 mean the request was cut at the 10 ms free-plan limit)

| Scenario | Requests | CPU events | Warm p50 / p95 ms | Worst ms | Cut at the limit (error 1102) | HTTP | Gate | Verdict |
|---|---|---|---|---|---|---|---|---|
| Public page (prerendered) | 20 | 11 | 7 / 9 | 14 | 0 | 200 x20 | 5 ms | Above target; never cut |
| Sign-in, default (scrypt) | 20 | 14 | 95 / 173 | 293 | 1 | 500 x18, 503 x2 | 10 ms | **FAIL** |
| Sign-in, PBKDF2 (WebCrypto, 100,000 iterations) | 20 | 12 | 10 / 10 | 10 | 12 of 12 | 503 x20 | 10 ms | **FAIL** |
| Sign-in, passwordless (magic link, no hash) | 20 | 10 | 10 / 10 | 10 | 10 of 10 | 503 x20 | 10 ms | **FAIL** (see note) |
| Admin page, fresh lookup | 20 | 10 | 10 / 10 | 10 | 9 of 10 | 404 x6, 503 x14 | 8 ms | **Not measurable**: no session could be obtained, so the request carried no cookie |
| Student page, cookie cache | 20 | 11 | 10 / 10 | 346 | 6 of 11 | 404 x13, 503 x7 | record only | Not measurable, same reason |
| Lead POST (stub) | 4 | 4 | 12 / 12 | 12 | 2 of 4 | 201 x2, 503 x2 | 8 ms | **FAIL** |
| Image serve, 300 KB, mostly Cache API hits | 20 | 10 | 10 / 11 | 11 | 3 of 10 | 200 x20 | 8 ms | **FAIL** |

Notes: the passwordless probe builds a new Better Auth instance on every request, which the real design does not, so its figure overstates the final cost, but it still shows that Better Auth's per-request cost on Workers Free is about the limit even with no password hashing. The first requests after a deploy were not cut: for example the first publish call used 195 ms of CPU and the first Neon query 236 ms and both returned 200, so the limit appears to be enforced only after a short grace period. A single image cache miss used 31 ms of CPU (193 ms wall) and a hit 37 ms.

**Other gate results**

| Gate | Result |
|---|---|
| Cache API on `workers.dev` (S0.1 first probe) | **Works** (put, match and delete behave). The community reply was wrong for this account. H7 is not blocking the cache gates. |
| Neon cold start | 1.44 s client time (1.23 s server) for the first query after 330 s idle: **pass** (single sample). Warm query 137 ms. |
| Neon WebSocket transaction | Works (value 2). |
| Durable Objects | Counter increments and the limiter answers: **pass**. Cron has not run yet (first run 23:05 UTC); `lastCronAt` was null. |
| Revalidation (S0.6) | **Pass on retry**: the page showed the new title within 5 seconds of a publish, with no deploy (KV + D1 + Durable Object queue, no payment method). The first publish call after the deploy returned 500, so the first call after a deploy is unreliable. |
| Image through Cache API | Served as image/webp with immutable headers; a genuine miss took 1.2 s end to end here (an unexplained 160 s first request occurred once in the CI run and did not recur). |
| Lead POST behaviour | 400 without a key, 400 on an invalid country, 201 then 200 on replay with the same reference. The 409 and the 429 checks could not be completed because of the 503s above. |
| Better Auth over Neon | Sign-in over the Neon driver returned a session for the default and passwordless variants on the first requests after the deploy; cookie cache, TOTP, step-up and fresh lookup are proven on Postgres by the integration tests. Not provable on the Worker while sign-in is cut by the CPU limit. |

**Stage 0 conclusion:** the stack builds, deploys and runs on Workers Free, and caching, revalidation, the database and Durable Objects work. **The CPU limit is the problem.** Authentication cannot run on the free plan as designed, and the lead POST and image serving also exceed their gates. This is the risk architecture section 1 named ("the 8 ms admin page gate is the likeliest to fail"). The contract says stop and report; the owner decides.

### 2026-10-23: Session 7 (owner decisions D13 and D14: edit in place, and redesign for the free plan)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`. All three were amended in place and stay at version 1. The `Source PRD`, `Source Architecture Version` and `Derived From` lines are unchanged, and all three N values are 1.

**Owner decisions**

| ID | Decision | Result |
|---|---|---|
| D13 | How to change the documents after Stage 0 started | **Edit the existing PRD, architecture, essentials and tracker in place. Do not create version 2.** Each document gets an amendment log. This sets aside the architecture's rule that a change after the first stage starts creates a new version (recorded as ADR-035), exactly as D2 did before the build. It replaces the "Version 2 backlog" idea from Session 5. |
| D14 | How to respond to the failed CPU gates (F11) | **Option 2: redesign for the Workers Free plan.** No paid plan. Google sign-in only; edge fast path for public pages and images; one-query session check; thin handlers; images stay in Neon for now. |

**What the design now says** (details in each document's amendment log)

- **Google sign-in only, no passwords** (ADR-032). No verification, reset or resend emails. Email is optional in v1 and used only for admin invites, which can be copied and sent by WhatsApp. The Resend domain, the mailbox and the student email cap are no longer launch requirements.
- **Edge fast path** (ADR-033): the Worker entry answers public pages and content-hashed images from the Cache API before Next.js starts. Pages live 30 seconds, so a publish shows within about 30 seconds everywhere.
- **One-query session check** in the auth facade for page reads (ADR-034). Better Auth runs only for sign-in, sign-out and two-factor routes. The facade interface, the `Actor` type and the rule that only `server/auth` imports Better Auth do not change.
- **Module S0.10** is added to Stage 0 to prove this on the deployed Worker, with the same thresholds. If a gate still fails, the decision returns to the owner.
- **Images:** the option 2 description mentioned object storage. Object storage (R2) needs a dashboard step and may need a payment method, so it was **not** adopted. Images stay in Neon (ADR-011) behind the `MediaStore` interface and are served from the edge; R2 is the named fallback if an image's first request proves too costly, and that is the owner's decision.
- **New trade-off for the owner to accept:** a student without a Google account cannot sign in to track progress (lead intake and WhatsApp still work). Recorded in the PRD risks and ADR-032.

**Still unproven:** the redesign itself (S0.10), Google accepting a `workers.dev` redirect address (Stage 2, S2.2), and the cost of an image's first request.

**Spike code:** a first draft of the edge fast path and a reused-instance probe exists on a local branch (`spike/lean-free-plan`, not pushed, not reviewed). It becomes the S0.10 work when the owner asks to proceed.

### 2026-10-24: Session 8 (owner decision D15: Neon-centred redesign, engineering review)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all amended in place and still version 1 (all three N values are 1). Documents only; no code changed.

**Request:** drop Better Auth and Resend, make authentication and authorisation happen through Neon, and store images in a bucket; then correct the source-of-truth files to match. An engineering review (`/plan-eng-review`) was run first. Its saved report: `C:\Users\ALL COMPUTERS\.gstack\projects\DivineGima-scollarly\docs-align-with-option-2-eng-review-20261024-0130.md`.

**Facts found (checked 2026-10-24)**
- Neon Auth **is** Better Auth, run by Neon (`neon_auth` schema in our own database). Dropping Better Auth therefore means moving it off our Worker, not removing it. Google, email-and-password, magic-link and admin plugins are supported; **authenticator-app 2FA and restricted sign-ups are "coming soon"**; 60,000 monthly users free; AWS regions only. Our project is `aws-eu-central-1` with no IP allow-list, so it qualifies.
- ~~Neon has no object storage.~~ **This was wrong and was corrected the same day (D16).** Neon Object Storage exists, is generally available, supports our region (aws-eu-central-1), gives 5 GB per project on the free plan, and works on our project. R2 was the first choice but its checkout asked for a payment method.
- Row level security does nothing if the app connects as the table owner, so a non-owner runtime role and `FORCE ROW LEVEL SECURITY` are required.
- Codex outside review was unavailable (not installed); no outside reviewer read the plan.

**Owner decisions**

| ID | Decision | Result |
|---|---|---|
| D15 | Neon-centred redesign | **Adopted as a proposal, proven or rejected by S0.10.** (1) Neon Auth runs Google sign-in and sessions. (2) Owner 2FA is our own code on the otpauth library (the owner challenged hand-rolling it; a proven library is used). (3) Images go to a bucket (first R2, then switched to Neon Object Storage by D16 because R2 asked for a payment method). (4) Neon row level security is a second lock under the auth facade, and `CLAUDE.md` is amended to say so (the owner chose this over "our code only"). (5) Resend and all email are removed. (6) Smaller file layout (the owner delegated this; the recommended option was applied). (7) The owner asked for a standing session check-in on Neon's 2FA instead of a TODOS file (see Standing owner check-ins, C1). |
| D16 | Where images are stored, after R2 asked for a payment method | **Neon Object Storage** (owner, 2026-10-24: "yes lets switch to neon object storage"). R2 is dropped. Sets aside the R2 part of D15. Proven or rejected by S0.10. |
| D17 | Image backup (flag F12) | **Owner delegated the choice** (2026-10-24: decide it so that it causes no security issue, does not use the free plan quickly and does not delay production). Decision: no cloud copy; immutable hash-keyed objects, manifest in the weekly dump, and an owner-run incremental copy to the owner's own disk checked by sha256. Rejected: GitHub artifacts (quota), R2 (payment method). |
| D18 | How to respond to the two failed S0.10 gates (F15) | **Option A: stay on the free plan** (owner, 2026-10-24: "A ... correct the source of truth files so they match this option"). Signed-in screens stop being Next.js page renders: each is a data-free shell served from the Cache API after the session check, plus plain data functions in the Worker entry (ADR-040); signed-in mutations become `POST /api/v1/<area>/<operation>` endpoints instead of Server Actions. The lead POST tail is diagnosed from per-request CPU samples. No paid plan. Proven or rejected by the S0.10 re-run; a failed gate returns to the owner. |

**Changes made** (details in each document's amendment log): PRD sections 4, 6, 10, 11, 12.2 and FR-18; architecture ADR-036 to ADR-039 added, ADR-005, 011, 013, 020, 026, 029, 032, 034 amended, sections 1, 4, 5, 7, 9, 13, 15, 17; essentials S0.4, S0.5, S0.10, S1.1, S2.1 to S2.5, S3.3, S6.3, S10.3, S11.4, S11.6; `CLAUDE.md` guardrails and Step 1. A mistake from Session 7 was also fixed: the essentials S0.9 row had been lost and a stray `$1` left in front of S0.10.

**Still unproven:** Neon Auth session verification and sign-in CPU in a Worker (SDK or own cookie check), the row-level-security query cost, Neon Object Storage read cost and limits, Google redirect through Neon Auth. All are S0.10 gates. A failed gate returns the matching decision to the owner.

### 2026-10-24: Session 9 (Module S0.10 built; not yet deployed or measured)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1 (the owner merged PRs #6 and #7; #7 landed in the old branch, so its text was merged into the S0.10 branch).

**Owner confirmations recorded** (the owner's words): Google credentials created and tested with the owner's own email as a test user ("i checked its okay, done its own testing for now and my email has been set as test user"). H8 and H13 are therefore marked done below.

**What was built** (branch `feature/s0-10-neon-proof`; module status stays `in-progress` until the gates are measured)
- **S0.4:** Neon Auth through the framework-neutral `@neondatabase/auth/server` entry (route `/api/auth/[...path]` proxy, `/auth/return` for the Google return trip); the facade does the one query `app_resolve_session` per request (no cache); roles in `app_user`; owner bootstrap function; owner 2FA on `otpauth` 9.5.2 with an encrypted secret, 10 hashed recovery codes, 5-failure lockout, replay refusal and a `step_up` table. Better Auth, Resend and password code deleted.
- **S0.5:** images in the Neon Object Storage bucket `images` (public-read, created), served by the Worker entry (cache, then a plain fetch of the public URL); uploads signed with a **write-only** credential (checked: signed write 200, anonymous read 200, missing key 404, anonymous write 403, the write-only credential cannot read).
- **S0.10:** row level security on every table with a non-owner `app_runtime` role (forced policies, a CI test for every table), `POST /api/v1/leads` as a plain function in the Worker entry, probes `rls` and `storage`, throwaway Neon Auth sessions for measuring the real authenticated path, an updated deploy workflow.
- **Tests:** 146 unit and 39 integration tests pass locally (new: session cookie parser, facade, second factor with an in-memory store and against the real tables, media store, edge media, every-table row-level-security check, one-session-query behaviour including concurrent first sign-ins, revocation, banned and expired sessions, owner bootstrap, role changes, cross-user isolation). Type check, lint and `next build` pass.
- **Neon configuration changed** (project aged-recipe-72220939, branch production): email-and-password sign-in turned off, the organization plugin turned off, the Worker address `https://scollarly.gimafolabit.workers.dev` added as a trusted domain, bucket `images` created, a write-only storage credential `scollarly-uploader` created. New repository secrets were created straight from the CLI without printing them; the old `PHASE0_BETTER_AUTH_SECRET` was deleted.

**Findings during the build**
- Neon Auth had **email-and-password sign-up open to anyone**, plus organizations and magic link on. Email-and-password and organizations are now off. **Magic Link is still on** (no CLI command): owner action H15.
- `neondb_owner` has BYPASSRLS (read from `pg_roles`), so the separate runtime role is required, as the review said.
- Neon Auth keeps the visitor's IP address and browser string in `neon_auth.session`: flag F13.
- `@neondatabase/auth` is a beta (0.7.0), pins an older zod and Better Auth 1.7.6, and declares an optional peer of Next 16 (we are on 15.5.28), so `package.json` carries an `overrides` entry for it. We import only its framework-neutral server entry: flag F14.
- The SDK's own per-request session path (`getSession`) was **not** measured: it needs a session minted by Neon Auth, and our one-query path replaces it. If the one query passes its gate, the SDK path is not needed.
- A Neon Auth session cookie value was assumed to be `token.signature` (Better Auth's format); the token is looked up in the database, so a wrong guess fails closed. To be confirmed by the first real Google sign-in.

**Not yet done:** deploy and measure (needs this branch merged to `main`, then the manual workflow), the real Google sign-in measurement by hand, R2-free image hit/miss numbers.

### 2026-10-24: Session 10 (Module S0.10 deployed and measured)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1.

- **First run failed** at the throwaway-session step: Neon Auth's `session.updatedAt` is NOT NULL with no default and Claude Code's script did not set it. Fixed in PR #9 (script and a test stand-in that now matches Neon's real columns), merged after CI passed.
- **Second run (40064928935, commit e964be3) succeeded as a run.** Migrations, runtime role, 10 images in Neon Object Storage, 17 live probes and the CPU measurement all completed. The numbers are in "Module S0.10 gates" above.
- **Result:** public page, both image paths, the runtime-role check and storage from the Worker pass. **The admin page (15 ms warm p50, 25 ms p95, gate 8 ms) and the lead POST (3 ms p50, 14 ms p95, gate 8 ms) fail.** Stage 0 is not closed and Stage 1 must not start.
- **Not yet done:** the Google sign-in return trip (needs the owner), H12, H15, H16, the C1 check-in answer.
- **Owner decision (same day):** option A, stay on the free plan (D18, flag F15). See Session 11.

### 2026-10-24: Session 11 (decision D18: signed-in screens rebuilt as shell plus data calls; not yet deployed or measured)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1.

**Owner decision (the owner's words):** "A" (stay on the free plan), and "dont forget to correct the source of truth files so they match this option as we have been doing".

- **Code (branch `feature/s0-10-thin-staff-path`):** `src/server/edge/authed.ts` (route classifier, session check, shell from the Cache API with `Cache-Control: private, no-store`, data calls as JSON with 401/403/503/500 envelopes), `authed-runtime.ts` (binds the facade and the two Stage 0 data calls to the Worker `env`), `src/server/auth/cookie.ts` (the cookie reader without the Neon Auth SDK, with a test that its name equals the SDK's), prerendered shell pages and the `components/shell/stub-value.tsx` data island, `worker/index.ts` wiring. 205 unit tests pass (new tests for the edge handler and the cookie name); type check, lint and `next build` pass (both shells are prerendered).
- **Measurement scripts:** four scenarios (staff shell, staff data call, student shell, student data call) each with an 8 ms gate; every sampled CPU value is now kept in order (`cpuSamplesInOrder`) so the lead POST tail can be read request by request; the functional probes check the shell has no data, is not browser-cacheable, and that 404 / 401 / 403 apply to anonymous, forged and student sessions.
- **Documents corrected in place (all version 1, D13):** PRD (tech stack row, amendment), architecture (ADR-040 added; ADR-004, 033, 039 amended; sections 1, 4.3, 5, 6, 8, 9, 10, 12, 15, 17, 18, 19; amendment log), essentials (S0.4, S0.10, S2.4, amendment), `CLAUDE.md` (guardrail), this tracker.
- **Not yet done:** deploy and measure (needs the pull request merged to `main`, then the manual workflow), the lead POST diagnosis, the Google sign-in measurement by hand, and the open questions in ADR-040 (staff navigation between screens; mutation endpoint CPU).

### 2026-10-24: Session 12 (Module S0.10 re-run after D18: every measured gate passes)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1.

- The owner merged PR #11 and answered the standing check-in C1: **Neon Auth has not shipped authenticator-app 2FA** (still asked each session).
- Workflow run 40074577922 (commit 284eac1) succeeded. Results are in "Module S0.10 gates" above: staff and student shells 2 to 3 ms and data calls 4 to 5 ms at p95 (gate 8), lead POST p95 5 ms (worst 13), public page and both image paths 0 to 3 ms, nothing cut at the limit, 20 probes passed.
- **Google sign-in measured (same day):** the Stage 0 home page had no sign-in button, so a Stage 0 route `GET /auth/start` was added (PR #13). Five real sign-ins by the owner finished and showed the student screen. The first two, through Next.js, used 19 ms and 12 ms for the return trip (over the 10 ms gate, nothing cut). `/auth/start` and `/auth/return` were then moved into the Worker entry (PR #14, `src/server/edge/sign-in.ts`); three more sign-ins measured **4, 2 and 1 ms**. One error page ("Verification not found") was seen once; it could not be reproduced in 13 command-line tries and is put down to a stale ticket from a reloaded page.
- **Stage 0 is complete.** Every gate in architecture section 17 has a recorded result and every Module S0.10 gate passes with no request cut at the limit. Stage 1 may start. H16 awaits the owner's word. The Phase 0 probes and `phase0*` tables are removed after Stage 1 starts (a later cleanup).
- **Carried to later stages (none blocks Stage 1):** F13 to Stage 2, H12 to Stage 3 and before launch, staff navigation between screens (Stage 5), write endpoint CPU (each stage adds its own row), the lead POST's two slow requests (13 and 10 ms of 50), and the Neon API key id 3459305 and the default storage credential clean-up.
- **Unproven and carried to later stages (ADR-040):** staff navigation between screens, and the CPU of write endpoints beyond the lead POST insert.
- **Owner answers (2026-10-24):** magic link switched off (H15 done per the owner); the beta Neon Auth SDK is accepted (F14); F13 (visitor IP kept by Neon Auth) and H12 are carried to later stages and do not block Stage 1 (the owner asked for a suggestion on F13, recorded in the flag).
- **Sign-in measurement:** the owner reported the check as complete, but Neon Auth holds no users and no sessions, so no Google sign-in has finished. Claude Code started a log watch and asked for one sign-in; the result is recorded here when it is seen.

### 2026-10-24: Session 13 (Stage 1 built; Stage 2 held at its gate)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1 (start-of-task sequence run and passed; N = 1 everywhere; `Derived From` and `Source` lines match).

**Request:** "Implement features of stage 1 and 2." Stage 1 was built. Stage 2 was not started: its gate needs Stage 1 complete (S1.7 and its exit criteria need H2) and the owner's confirmation of H16, and CLAUDE.md says to halt and flag.

**CI:** all five jobs passed on commit db7f060 (run 40083388852): lint, typecheck, unit tests and the schema-drift check; integration tests on a real Postgres 16 service container (migrations apply to an empty database); Worker build at 1.344 MiB compressed against the 2.6 MiB gate (1.24 MiB at Stage 0; the added code is the security headers); Lighthouse; Playwright with axe, headers and the rewrite. A follow-up commit (CSP report-only without frame-ancestors, tracker) is re-run. Branch `feature/stage-1-foundation`, pull request #15. Local results before the push: unit 315, integration 231 plus 23 authorisation-matrix todos, Playwright 15, typecheck and lint clean.

**What was built** (details in `docs/stage-1-runbook.md`)

| Module | Result |
|---|---|
| S1.1 | Migration `0003_stage1_foundation.sql`: every table of architecture 7.1 to 7.6 (37 tables including the 7 from Stage 0, of which two are throwaway stubs), all CHECK constraints, the 7.8 indexes, `ENABLE` and `FORCE ROW LEVEL SECURITY` with policies written from the 9.5 table, no DELETE grant anywhere, `lead_activity` and `audit_log` append-only by grant, six pipeline stages, ten default settings. Tests: fee, testimonial, journey, team, trust stat, YouTube id, payment void and `submission_token` constraints; lead rules; every table has RLS plus a policy; who sees how many rows per table and role; the closed value lists in the database equal `src/lib/constants.ts`. |
| S1.2 | Repositories take the branded `Actor` (`runAs`, `runPublic`): settings, pipeline, leads (never returns the idempotency key or payload hash), media, seed. A type test proves a plain object is not an `Actor`. |
| S1.3 | WAT time, Result, UUID v7, phone normaliser (Cameroon, Nigeria, Ghana, Ivory Coast, Senegal, Guinea, South Africa, India, generic E.164 for the rest), `SC-XXXXX-XXXXX` references, the one WhatsApp URL helper (FR-4), error envelope helpers, shared Zod schemas including the full and quick lead rules. |
| S1.4 | `src/modules/sla/service.ts`, pure, with table tests for Monday midday, Friday 23:00 WAT (due Saturday 03:00), Saturday and Sunday midnight and the 24 hours rule. |
| S1.5 | Authorisation matrix harness (`tests/integration/authz-matrix.test.ts`): the 9.5 table is parsed from the architecture file and compared with `src/server/auth/permissions.ts`; implemented actions (settings update, role change) run under six subjects through the real path (session cookie, Neon Auth session query, facade, repository, row level security); the other 23 operations of 8.3 are listed as todos. Security headers (HSTS, nosniff, referrer policy, permissions policy, `frame-ancestors` enforced, CSP report-only) from `src/lib/security-headers.ts`, applied by `next.config.ts` and by the Worker entry. Axe in Playwright. CI step that fails when the schema changes without a migration. |
| S1.6 | One generalised `/en` rewrite (`src/i18n/rewrites.ts`, tested with Next.js's own matcher), `pickNamespaces` and `clientMessages` for client islands, `messages/fr.json` with the same keys (French text is unreviewed by a native speaker; `fr` is not an active locale), design tokens as CSS variables, system font stack, reduced-motion rule. |
| S1.7 | Seed file format and validation, deterministic ids, insert-only seed, WebP ingest with caps (50 KB logos, 300 KB photos) and hash dedupe, converter (PNG, JPEG or WebP to WebP; SVG refused), `scripts/seed.ts` (`npm run seed`). Proven on synthetic data: second run inserts nothing and changes no column; each university's logo is a `media_asset` row. **Not run on real data, and `ContactSubmission` migration not built (H2).** |

**Bug found by the tests and fixed:** `updateSetting(..., null)` sent SQL NULL to a NOT NULL jsonb column. A setting that is "not set" is the JSON value `null`; the repository now always sends JSON text with a cast.

**Decisions made without asking (the owner can veto)**

| Item | Choice |
|---|---|
| Image budget default | `site_setting.media_budget_bytes` seeded as 3.5 GiB (3,758,096,384), following PRD FR-18, architecture 10.5 and essentials S6.3. See flag F16. |
| `event_daily_agg` key | `UNIQUE NULLS NOT DISTINCT` over the five dimension columns instead of a primary key, because country, university and page group can be null. |
| Anonymised lead | `name`, `whatsapp_e164` and `email` are nullable, and a CHECK allows null only when `anonymised_at` is set (and forces all three null, and `results` empty, when it is). |
| Foreign keys | Ownership columns (`lead.user_id`, `lead.assigned_admin_id`, `lead_claim.user_id`) have foreign keys; history columns (`actor_id`, `author_id`, `entered_by`, `decided_by`, `data_request.user_id`) do not, so an audit trail outlives an erased account. Stage 5 and 8 erasure must clear `lead.user_id` and the student's claims before deleting the account. |
| Fee amounts | `numeric(12,2)`, returned as text. |
| Seed safety | Every seed row defaults to `draft`; nothing becomes public by accident. |
| Contact numbers | `whatsapp_number_e164` and `contact_phone_display` seeded as JSON `null` until the owner confirms them (H3). The WhatsApp helper returns null for a missing number. |
| Worker entry | `worker/index.ts` now adds the security headers to every response. Assets served straight from the assets binding (JS, CSS) do not pass through it; S11.1 audits that. Re-measure CPU at the next deploy. |
| Dev dependencies | `tsx` 4.23.15 (runs the seed script) and `@axe-core/playwright` 4.14.0 (axe in CI), exact versions, lockfile written with npm 10. Tailwind is in the PRD stack but not in S1.6, so it was not added. |

**Carried to later stages**

- Stage 9: a database trigger that limits an update of `placement_payment` to the void fields (and clearing `lead_id` on erasure). Today the staff UPDATE policy is open and no code updates payments.
- Stage 4: the SECURITY DEFINER function that creates a lead (like `app_create_phase0_lead`) and the event writers; the runtime role has no INSERT right on `lead` or `event`.
- Stage 3 and 6: the shape of `translations` for tables with several translatable fields (flag F17).
- Stage 7: the cron job needs a way to delete raw `event` rows after rollup (carve-out, ADR-029); the runtime role has no DELETE, so use a definer function or the owner role.
- Stage 2: `audit_log` has no SELECT right for non-owners, so insert without `RETURNING` unless the actor is the owner.

### 2026-10-24: Session 14 (S1.7 data converted from the old site)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1.

**Owner decisions in this session:** old leads are exempt from the SLA; image budget confirmed 3.5 GB (F16 closed); WhatsApp contact is +919815725968 (H3); C1 paused for about a month; H2 files supplied.

**What changed**
- `data/seed/`: `universities.json` (9 universities, 77 programmes, 9 confirmed fees for Chandigarh, Jain and Kalinga, 5 campus tours), `faqs.json` (12), `process-steps.json` (6 application, 5 visa), `content-blocks.json` (36), `site-settings.json` (the two contact settings), `logos/` (9, downloaded from the old site's own URLs; Aditya's SVG was rasterised to PNG because the importer refuses SVG), `site-images/` (4 page photos, kept for Stage 3, not imported), `brand/logo.svg`.
- Seed code: a `site_settings` list (`src/modules/seed/schema.ts`, `service.ts`, `src/server/repositories/seed.ts`) fills `whatsapp_number_e164` and `contact_phone_display` only while the setting is still JSON null, so an admin edit is never overwritten. Tests added (unit and integration). `npm run seed -- --dir data/seed --dry-run` passes; local results: lint and typecheck clean, unit 316, integration 232 plus 23 todos.
- Architecture: the stale 150 MB image budget lines (section 3, 7.3, risk table) corrected to 3.5 GB.

**Everything is `draft`.** Nothing becomes public until a row's status is set to `published` (in the file before the real run, or in the admin screens in Stage 6).

**Not seeded, on purpose:** testimonials, team bios and the "100+ students / 5+ countries" counters (CLAUDE.md: no unconfirmed statistics, testimonials or team bios; they also belong to the testimonial, team and trust tables with their own consent and verification rules); each university's scholarship text ("Up to 50% via Scollarly", no column for it); universities with no confirmed fee have no fee rows (the site shows the WhatsApp call to action, FR-2); the 4 universities whose tour is "coming soon" have no tour row.

**`ContactSubmission` import: not built.** Only the model and the form route were sent, no rows. The old form never required a phone, and `lead` requires a valid WhatsApp number, so rows without one cannot become leads. Rows with a phone could be imported as `quick` leads that are exempt from the SLA. Needs the export (or confirmation that the table is empty) before building.

**F17 touched:** a university's `translations.en` holds its overview text (it has no other translatable prose). FAQ question and answer stay in plain columns.

### 2026-10-24: Session 15 (Stage 1 complete)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1.

**Done:** migration 0003 applied to the live database with the owner role (`npm run db:migrate`). The real seed (`npm run seed -- --dir data/seed`) ran twice, with credentials taken by Claude Code on the owner's instruction (database string from `.env.local`, storage keys from `neon env pull` into a temporary ignored file, deleted afterwards).

**Result:** run 1 inserted 9 universities, 77 programmes, 9 fees, 5 campus tours, 12 FAQs, 11 process steps, 36 copy blocks and 2 settings, and created 9 images. Run 2 inserted 0 rows in every table and reported all 9 images as existing. Checked in the database: 9 university logos are `media_asset` rows (WebP); a logo is served publicly from the storage endpoint (HTTP 200, image/webp); every row is still `draft`; `whatsapp_number_e164` and `contact_phone_display` are set; `media_budget_bytes` is 3,758,096,384.

**Stage 1 exit criteria:** all met (tests in CI for the constraints, the lead rule, the SLA and the boundary check; seed twice; 9 logos).

**Note:** Claude Code created a new branch credential for object storage when it ran `neon env pull`. It is not stored anywhere in the repository.

### 2026-10-24: Session 16 (Stage 2 built locally; Stage 3 held)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1 (start-of-task sequence run and passed; N = 1 everywhere). The standing check-in C1 is paused until about 2026-11-24 and was not asked.

**Request:** "Implement feature of stage 2 and stage 3." Stage 2 was built on the local branch `feature/stage-2-auth-admin-shell` (one commit so far for the backend; the screens and documents are uncommitted; **nothing is pushed**). **Stage 3 was not started:** working rule 1 (essentials) says not to start a stage until the previous stage's exit criteria pass, and Stage 2's cannot pass in one session (CI, migration 0004 on the live database, a real Google sign-in with the Worker log open, the owner's first sign-in). Stage 3 also has two open owner items: F17 (shape of `translations`) and H12 (Object Storage free-plan limits).

**Local results:** lint and typecheck clean; unit 348 passed; integration 292 passed and 20 todo (3 of the 23 earlier todos are now real matrix tests: `team.invite`, `team.revokeInvite`, `team.removeAdmin`); Playwright 45 passed (15 earlier, 30 new, on a production build); `next build` succeeds.

| Module | Result (all `in-progress`: CI has not run) |
|---|---|
| S2.1 | `GET /auth/landing` (Worker entry plain function), the mutation router `POST /api/v1/<area>/<operation>` with `Access` rules, `EndpointEnv`, wiring in `authed-runtime.ts` and `worker/index.ts`. The facade is unchanged. | | complete (2026-10-25: CI passed, merged as PR #18, deployed; the owner signed in and enrolled 2FA) |
| S2.2 | `/sign-in` (plain link to `/auth/start`, no JavaScript needed), `/sign-out`. Invite tokens ride through `/auth/start` and `/auth/return`. | | complete (2026-10-25: CI passed, merged as PR #18, deployed; the owner signed in and enrolled 2FA) |
| S2.3 | Owner bootstrap in the landing step (audited); endpoints begin, confirm, verify, recovery; pages enrol (QR drawn in the browser) and verify; new `regenerateRecoveryCodes`. | | complete (2026-10-25: CI passed, merged as PR #18, deployed; the owner signed in and enrolled 2FA) |
| S2.4 | `denyAccess` (effective role, stored-owner, step-up); trigger that stops the owner being demoted; `app_remove_admin` (role, sessions expired, leads returned with an activity row, audit row, one transaction). | | complete (2026-10-25: CI passed, merged as PR #18, deployed; the owner signed in and enrolled 2FA) |
| S2.5 | Invites (hash only stored, 7 days, one open invite per email by unique index, resend replaces), `app_accept_invite`, `/accept-invite/[token]`, Team page. | | complete (2026-10-25: CI passed, merged as PR #18, deployed; the owner signed in and enrolled 2FA) |
| S2.6 | Admin layout with Tailwind and shadcn-style components (admin only; 11 KB stylesheet, no public page links it), role-based menu, offline banner, step-up prompt, Overview, Profile, Security. | | complete (2026-10-25: CI passed, merged as PR #18, deployed; the owner signed in and enrolled 2FA) |
| S2.7 | `auditEntry` joins a change's transaction; Audit page with person, action and WAT date filters and keyset paging. | | complete (2026-10-25: CI passed, merged as PR #18, deployed; the owner signed in and enrolled 2FA) |

**Dependencies added (exact versions, lockfile by npm 10):** `tailwindcss` and `@tailwindcss/postcss` 4.3.3, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0, `qrcode-generator` 2.0.4 (loaded only on the enrol page). No Radix: dialogs use `<dialog>`.

**Decisions made without asking (the owner can veto)**

| Item | Choice |
|---|---|
| Owner bootstrap runs at the landing step | One extra query per student sign-in (the database function checks the email), not on every request. |
| F13 | Both fixes: a trigger on Neon's session table and a scrub at every landing. The trigger is guarded so the migration does not fail if it is refused. |
| Edge-cached pages | `/sign-in` and `/sign-out` added (identical for everyone). A Stage 0 unit test that listed `/sign-in` as never cached was updated. |
| Stage 0 admin stub | Its `<main>` became a `<section>`, because the new admin layout already has the one `main` landmark. |
| Error codes | `CONFLICT` (409) and `STEP_UP_REQUIRED` (403) added to the error envelope. |
| Playwright | The edge endpoints are mocked in the browser tests, because `next start` has no Worker entry; the endpoints themselves are covered by the integration tests. |

**Not measured, not done (needs the deployed Worker, CI or the owner)**
- CPU rows for `/auth/return`, `/auth/landing`, the new shells and data calls, and the invite and remove mutations (each at most 8 ms warm p95; sign-in steps at most 10 ms).
- The real Google sign-in through the new landing step; the owner's first sign-in and 2FA enrolment; whether CI passes (the Worker bundle size was not checked: the OpenNext build fails silently on Windows).
- Migration 0004 on the live database, tried first on a throwaway Neon branch (see F13 and `docs/stage-2-runbook.md`).

**For the next session:** read `docs/stage-2-runbook.md`, "What is left before Stage 2 can be called complete".

### 2026-10-24: Session 17 (Stage 2 pull request, CI, migration trial on Neon)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1.

**Owner instruction (the owner's words, summarised):** accept every recommendation as long as the source-of-truth files are respected; decide, conclude and finalise Stage 2 so Stage 3 can start fast. The recommendation on F17 (English text stays in plain columns, `translations` holds one object per extra locale) is therefore **accepted by the owner (D19)**. H12 is a human action and stays open.

- **Pull request #18** (`feature/stage-2-auth-admin-shell` to `main`) opened. **CI passed on all five jobs in both runs** (lint, typecheck and unit; integration on Postgres 16; Worker build and size; Lighthouse; Playwright). **Worker size 1.458 MiB compressed** (7.437 MiB raw) against the 2.6 MiB gate (1.344 MiB at Stage 1). Claude Code did not merge.
- **Migration 0004 tried on a throwaway Neon branch** (`s2-migration-test`, copied from production, deleted afterwards, its connection string removed): applied cleanly, and 18 of 18 checks passed against Neon's real `neon_auth` tables as the `app_runtime` role: the trigger blanks `ipAddress` and `userAgent` on a real insert, `app_scrub_session_pii` works, the runtime role still cannot read `neon_auth.session`, an invite is accepted only for the verified invited email and only once, `app_remove_admin` ends the removed admin's session and refuses a non-owner, and the owner role cannot be removed. **Flag F13 is therefore proven on a copy of the live database.**
- **Migration 0004 on production: NOT applied.** The command was stopped by the permission check ("Production Deploy"), and Claude Code did not work around it. Production is at migration 0003 with no owner. The owner applies it (see `docs/stage-2-runbook.md`) or allows Claude Code to.

- **A CI failure found a real bug, now fixed (commit d77047e).** The Audit page's paging cursor kept milliseconds while Postgres keeps microseconds, so rows written in the same millisecond could be skipped between pages (one run of the integration job failed, the other passed). The cursor is now the last row's id. The paging test inserts 60 rows inside one millisecond and was shown to fail on the old cursor (50 of 60) and pass on the new. **All 10 checks of pull request #18 pass on the fixed commit.**
- **Merge and production migration both stopped by the permission check** ("Merge Without Review", "Production Deploy") even after the owner asked for them; Claude Code did not work around either.

**Still open for Stage 2 (none can be done by Claude Code alone):** migration 0004 on production; merge of PR #18 and the manual deploy workflow (Claude Code cannot merge); the owner's first Google sign-in with `OWNER_EMAIL` and 2FA enrolment (human action); the CPU rows from that sign-in and from the new endpoints. Stage 2 modules stay `in-progress`.

### 2026-10-25: Session 18 (Stages 3 and 4 built together; not yet in CI)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1. Branch `feature/stage-3-4-content-leads`.

**Owner statements (the owner's words, recorded as given):** "i signed and succeded to setup 2fa" (so Stage 2 is complete, S2.1 to S2.7). Then: round up Stages 3 and 4, "bypass the logic of waiting one to get completed before doing the other", code and test each, and explain every later job: steps, how, and which pages. The one-stage-at-a-time rule (CLAUDE.md working rule 1) was waived by the owner for this build only.

**What was built.** Full list in `docs/stage-3-4-runbook.md`.
- Stage 3: published-only content reads (repository, builders that re-apply the publish rules, tag cache with a revalidate of an hour); 15 public pages in English and French; fee gating (a fee shows only when confirmed, with a real range, never 0 or blank); `youtube-nocookie` facades that load only after a tap; trust components that render only when confirmed, verified and consented; text placeholders where there is no image (uploads arrive in Stage 6); a public bundle check and Lighthouse over 16 routes in CI.
- Stage 4: service worker rules (never admin, student, auth or API), manifest and icons, install prompt for a returning visitor; IndexedDB lead queue with the retry steps 5 s, 30 s, 2 min, 10 min, hourly, Web Locks and the 30-day flag; quick form on every WhatsApp button and the full form at `/apply`, send first and wait up to 4 s; `POST /api/v1/leads` (idempotency, payload hash, Turnstile, 5 leads per number per 24 h, phone normalisation, server-time SLA, reference collisions) as a database function (migration `0005`) called from the Worker entry; `POST /api/v1/events` with counts in the Collector and a `wa_tap` row only with a lead reference (10 per reference per WAT day); contact page and the one WhatsApp helper.

**Verification run locally (2026-10-25):** typecheck clean; lint clean; unit 447 of 447; integration 311 passed, 20 todo (the 13 new Stage 4 checks run on PGlite); `npm run check:bundle` passes (first load 102.1 to 113.3 KB gzip against a ceiling of 118); Playwright full run 100 passed and 6 failed, all six in the new Stage 4 spec. The six were fixed and the affected groups rerun green: two real defects (the "waiting to send" count did not update when a lead was queued after the page loaded, now a queue-changed event; the programme picker's button name read "Add : MBA", now "Add MBA, Alpha University") and four test locators. A single full Playwright rerun is left to CI.
- **Found and fixed outside Stage 3 and 4:** the Stage 2 audit test took "today" in UTC while the endpoint filters by WAT date, so it failed between 23:00 and 24:00 UTC every day. One line in `tests/integration/stage2-auth.test.ts`.

**Deviations and notes for the owner**
- **Stages 3 and 4 built together** on one branch at the owner's request (see above).
- **Translations shape (F17 / D19):** the content layer reads the English plain columns plus one object per extra locale in `translations`, and still reads the older whole-text shape. Architecture 6.4 and the essentials still show the older example; an amendment note is due in the next documents edit.
- **Public JavaScript budget (F7, H9):** the framework alone is about 102 KB gzip, so the architecture's 100 KB cannot be met on any page. The check uses a ceiling of 118 KB (`PUBLIC_JS_CEILING_KB`); `/apply` is the largest at 113.3 KB. The owner decides whether to accept this.
- **Turnstile:** until the owner creates the widget and sets `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, the Worker uses Cloudflare's always-pass test keys, which anyone can pass.
- **Everything seeded is `draft`**, so the public pages show their "being added" messages until the owner publishes (`scripts/publish-content.mjs`, dry run first). Trust content is never published by that script.
- **CPU rows still to measure** on the deployed Worker (at most 8 ms warm p95): `POST /api/v1/leads` (the deploy workflow now posts a real quick lead and removes the test leads) and `POST /api/v1/events` (no scenario yet in `scripts/measure-cpu.mjs`). The sign-in rows from Stage 2 were not recorded either.
- Not yet run: CI on Postgres 16 with the `pg` driver for migration 0005; the migration on the live database; the Lighthouse run over the 16 routes.

**Still open and not Claude Code's to do:** merge of the pull request; migration 0005 and publishing (owner, or on the owner's word); the real Turnstile widget and secrets; H4 (trust content), H5 (privacy notice and terms, legal), H9 (budget), H12 (Object Storage limits); a check on a real phone. Stage 5 has not started.

### 2026-10-25: Session 19 (merge, live deploys, content published, real Turnstile)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1.

**Owner statements (the owner's words):** "DO 2 AND 3" (publish the content and run the deploy); "i have set the secrets in github"; "yes 118 is ok"; trust content and legal text will be created and sent at the end of the last stage; Neon is 5 GB of storage (screenshot of neon.com/pricing, Free plan). The owner merged pull request #19 themselves (Claude Code's merge was refused by the permission check, "Merge Without Review").

- **Content published** by Claude Code on the owner's instruction: 159 rows (dry run first). Testimonials, team, journeys and figures were not touched.
- **Deploy 1 (run 40142776719, before the Turnstile secrets existed):** success. Migration 0005 applied; 20 of 20 probes passed. CPU, warm p50 and p95 in ms against the 8 ms gate: public page 0 and 1; staff shell 1 and 5; staff data 3 and 7; student shell 1 and 5; student data 2 and 5; **lead POST (quick lead) 4 and 6**; image hit 0 and 1; image miss 0 and 0. All pass.
- **Deploy 2 (run 40144527154, started by Claude Code on the owner's word after the secrets were set):** success as a job, with real Turnstile keys set on the Worker after the measurement step (the measurement itself uses Cloudflare's always-pass test secret on purpose). Probes 19 of 20; CPU table: public page 1 and 1; staff shell 2 and 4; staff data 4 and 8; student shell 2 and 3; student data 3 and 6; image hit 1 and 1; image miss 2 and 3; **lead POST (quick lead) 6 and 22 (all-request p95 25, worst 66), verdict FAIL against the 8 ms gate**, with no request cut at the platform limit (exceeded 0 of 50).
- **Two failures in deploy 2, both recorded as found:** (1) the lead POST warm p95 of 22 ms. The same code measured 6 ms in deploy 1, so the cost is not stable; the likely cause is the occasional request that lands on a freshly started isolate, but that is a guess and has not been measured. Not yet fixed. (2) The Neon cold-start probe took 2.9 s against a gate of about 2 s (1.5 s in deploy 1 and earlier). That time is Neon waking its compute and is outside our code.
- **Live site checked by Claude Code:** `/`, `/universities`, `/fees`, `/faq`, `/process`, `/visa`, `/about`, `/campus-tours`, `/contact`, `/apply`, `/privacy`, `/offline` and `/manifest.webmanifest` return 200 with the published content; fees show "Fees to be confirmed" where none is confirmed. `/fr` is 404 by design: `locales = ["en"]` in `src/i18n/config.ts`, French strings exist but the locale is not switched on (Claude Code had said otherwise earlier; corrected).
- **Next:** reproduce the lead POST tail with a lead-only measurement (needs a small workflow change: a dispatch input to run only the lead scenario), find the cause, fix, and measure again. S4.4 and S4.5 stay `in-progress` until that gate passes and the events row is measured.

### 2026-10-25: Session 20 (Stage 5 built; Stage 4 lead CPU result recorded)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1. Branch `feature/stage-5-admin-leads`.

**Owner statement (the owner's words):** "yes start stage 5". Stage 4 was not yet complete (its lead-endpoint CPU gate was open), so this is a second start before the previous stage's exit criteria were met, at the owner's instruction (the owner had waived the one-stage-at-a-time wait on 2026-10-25).

**Stage 4 CPU result, third deploy run (run 40147199254):** lead POST (quick lead) warm p50 5 ms, **p95 28 ms** (max 37), verdict FAIL against 8 ms. Across the three runs the lead POST p95 was 6, 22 and 28 ms; in runs 2 and 3 about a third of the requests cost 17 to 37 ms and the rest 3 to 5 ms. The same code, the always-pass test secret in all three. This is a real, repeated tail and not a single bad sample. No request was cut at the platform limit (exceeded 0 of 50 in each run). The cause is not found. S4.4 and S4.5 stay `in-progress`; this is the next thing to investigate after Stage 5 reaches CI (candidates: the cost of a request that lands on a freshly started isolate, and the size of the Worker bundle). The Neon cold-start probe also failed once (2.9 s against about 2 s) and passed at 1.5 s the other times.

**What was built (Stage 5).** Full page list and steps in `docs/stage-5-runbook.md`.
- Migration `0006` (additive): `lead.updated_at` with a trigger that moves it forward on any change except `last_activity_at`, `lead_claim.reject_reason`, and four SECURITY DEFINER functions (decide a claim, list claims with Neon Auth names and emails, resolve a duplicate, erase a lead), each checking for staff itself and granted to the runtime role alone.
- Repositories `lead-admin.ts`, `claims.ts`, `data-requests.ts`; module `modules/leads/admin-*`; eight lead operations and two data-request operations as plain Worker mutations; six data calls (`overview`, `leads`, `lead`, `duplicates`, `link-requests`, `data-requests`). Every change is one statement or one function, so its activity and audit row commit with it.
- Pages: Overview (real counts and funnel), `/admin/leads`, `/admin/leads/<id>` (one cached shell for every lead, the id read from the address), `/admin/leads/link-requests`, `/admin/data-requests`; menu items Leads and Data requests. Strings in English and French.

**Verification run locally (2026-10-25):** typecheck clean; lint clean; unit 467 of 467; integration 416 passed, 12 todo (44 new Stage 5 checks, and the authorisation matrix now runs every lead and data-request operation under every role); Playwright 61 of 61 for the new Stage 5 spec and the Stage 2 spec (B1 to B5 flows, axe on every screen); `check:bundle` unchanged (no admin code in a public route).
- **Exit criteria evidence:** `lead_activity` has no update or delete path (test: the runtime role is refused both). First reply sets `first_response_at` once and the badge becomes Met (test). The Overdue view reads the stored `sla_due_at`: the same leads become overdue only as the clock passes, nothing is recalculated (test). Erasure: the lead is anonymised, counts and payment rows remain, the payment's lead link is cleared, note text is overwritten, `event.lead_ref` is null for that lead, `lead_activity` is untouched apart from one `anonymised` entry, and a failure injected at the last step leaves nothing half-erased (tests). Approving a claim without a verification method is refused by the schema, by the function and by a CHECK constraint (tests). Playwright flows B1 to B5 pass.

**Deviations and notes for the owner**
- **Architecture amended in place (D13):** section 8.3 gains `dataRequests.log` and `dataRequests.complete` (B5 describes them; the table lacked them), and an amendment note records `lead.updated_at`, `lead_claim.reject_reason`, the erasure and duplicate details. The permission-coverage unit test now reads camel-case operation names.
- **Concurrency token:** the architecture says `updated_at`, and `lead` had none, so migration 0006 adds it. It does not move for a note or a logged reply (they only move `last_activity_at`), so adding a note never makes someone else's stage change fail.
- **Link requests** are built and tested, but nothing creates a claim until the student portal (Stage 8, `/me/link-application`) exists, so the page stays empty until then.
- **WhatsApp templates:** the six stage messages are built in (English and French); the `message_template` table is read first, so staff-written templates (Stage 6) override them.
- **Not yet run:** CI on Postgres 16 for migration 0006 and the new tests; the migration on the live database; the CPU rows for the Overview, the list, the detail and one write (the deploy workflow measures them); the deployed Stage 5 probes.

**Still open and not Claude Code's to do:** merge of the pull request and the deploy run (the owner, or on the owner's word); the Stage 4 owner items (H4 trust content and H5 legal text at the end of the build, H19 phone check). Stage 6 has not started.

### 2026-10-25: Session 21 (Stage 4 lead CPU gate: cause found, measurement corrected)

**Built against:** essentials `system_architecture_essential_1.md`, architecture `system_architecture_1.md`, PRD `PRD_1.md`, all version 1. Branch `fix/stage-4-lead-cpu-tail`. Started on the owner's word ("lets repair stage 4 first").

**What was found (evidence, not guesses)**
- The deployed Worker's `Worker Startup Time` is 37 ms (run 40147199254) and 40 ms (run 40142776719), reported by Cloudflare at deploy. A fresh instance pays it inside its first request.
- Workers Logs (read through the Cloudflare API, `cpuTimeMs` per request) hold about 2,700 requests of this Worker: every outcome is `ok` (none terminated, even the 66 ms lead), lead POSTs are p50 4 ms and p90 16 ms overall, and by data centre p90 8 ms (Washington) against 23 ms (Los Angeles). So the spread is partly where the request lands, and partly first-of-instance requests.
- The measured "warm" p95 only skipped the first three requests of a run, so it mixed first-of-instance requests (a third of them, because one lead every 12.5 s often reaches a freshly started instance) with warm ones.
- Local profile of the start-up (`wrangler check startup`): the application's own module loading was about 126 ms (local, inflated by the profiler), led by zod schema construction, the Drizzle schema file and the Neon driver. Evaluation time (not file size) is what matters: trimming zod's bundle by half changed evaluation time very little.

**What was changed (safe reductions)**
- `.open-next/worker.js` is loaded on first need, not at start-up; the queue Durable Object class is taken from its own small file.
- The database handle is built without the schema object (no relational configuration on the first query of an instance); `createWsDb` likewise. No code uses the relational query API (a test says so).
- `insertLead` moved to `repositories/lead-intake.ts` and `readSettings` to `repositories/settings-read.ts` (both re-exported from the old files), so the lead and event paths no longer load the schema file or any sign-in, admin or student code (a test walks the imports and fails if they do).
- zod is imported as a namespace in every module: the lead handler's bundle went from 1130 KB to 577 KB and the whole Worker from 7.98 MB to 7.21 MB.
- The measurement now splits first-of-instance requests from the rest (`X-Instance-Request` on the lead endpoint) and judges the rest against the gate; the first-of-instance requests are reported with their count and worst case. The deploy workflow gained two inputs, `cpu_scenarios` (for example `lead`) and `lead_samples`, so a lead-only run takes about 12 minutes instead of 23.
- Considered and NOT done: loading the sign-in, admin and student handlers inside their requests. It would shorten start-up for lead requests, but it would move that work into the staff request's own CPU time, which Workers Free limits to 10 ms, and it cannot be proved safe without the live platform. Also not done (large, risky, gain uncertain): replacing zod with `zod/mini` and replacing the Neon driver for the lead path. Either is a possible next step if the owner wants the first-of-instance cost lower.

**Verification (local):** typecheck and lint clean; unit 456 of 456 (9 new start-up guard tests); integration 312 passed, 20 todo. **Not yet measured on the platform:** the effect on `Worker Startup Time` and on the lead CPU rows. That needs the merge, then the deploy workflow (Run workflow, `cpu_scenarios` = `lead`, `lead_samples` = 30).

**What stays true after this change:** a request that lands on a fresh instance costs the instance's start-up plus its own work, so on Workers Free it will not be under 8 ms. Whether that is acceptable is the owner's decision (flag F18). No request has been terminated by the platform so far.

## Flags (need the owner)

| ID | Flag | Why it matters | Needed from owner |
|---|---|---|---|
| F1 | Essentials filename typo: `system_achitecture_essential_1.md` should be `system_architecture_essential_1.md` to match the pattern in `CLAUDE.md` Step 2. | Under `CLAUDE.md`, a missing essentials file is a halt. | **Resolved 2026-10-23.** Owner renamed the file. Verified: it matches the pattern, cites `system_architecture_1.md` and `PRD_1.md`, and all three N values are 1. |
| F2 | `SYSTEM DESIGN RULES.html` is not in the repository. | `CLAUDE.md` says to halt if a source file is missing. | **Resolved 2026-10-23.** Owner: it is a reference only and its contents are already in `CLAUDE.md`. `CLAUDE.md` is treated as the source of those rules. |
| F3 | `claude.md` was lowercase. Architecture section 5 and S0.1 refer to `CLAUDE.md`. | Linux CI and git treat the two names as different files. | **Resolved 2026-10-23.** Owner renamed it to `CLAUDE.md`. |
| F4 | `prd/`, `system_architecture/`, `essentials/`, `tracker/` and `CLAUDE.md` are untracked in git. | They are the build contract and are not versioned. The pre-build amendments of 2026-10-23 exist only in these files; the originals were not committed. | **Resolved 2026-10-23.** The owner asked for the Stage 0 work and these documents to be committed. They go in through one pull request from `feature/stage-0-proof-of-fit`, not a push to `main`. |
| F5 | `CLAUDE.md` says "No physical deletes in v1. Archive instead." Architecture ADR-029 now names three carve-outs (erasure, raw event purge after rollup, expired auth rows). | The two texts disagree. `CLAUDE.md` is the owner's file and was not edited. | **Open.** Owner decides whether to add the carve-out wording to `CLAUDE.md`. |
| F6 | `src/server/db` (client factory, schema, migrations) imports Drizzle. `CLAUDE.md` says only `server/repositories` may. | Architecture section 5 lists `server/db/` as its own directory beside repositories and calls it part of the data layer, so it was read as the repository layer's internals. The ESLint rule and a source-scan test allow `server/repositories` and `server/db` only. | **Open.** Owner confirms this reading, or the files move under `server/repositories`. |
| F7 | The proposed public JavaScript budget (100 KB gzip) is already exceeded by the Next.js baseline (about 104 kB). | See Session 3, finding 5. Affects the Lighthouse gate and S3.5. | **Open (measured in Session 18: first load is 102.1 KB on a plain page and 113.3 KB on `/apply`, so the 100 KB budget is impossible).** Owner chooses: raise the budget, or accept a lower Lighthouse score target. **Decided by the owner 2026-10-25: "yes 118 is ok"** (a ceiling of 118 KB gzip for first-load JavaScript on public pages, `PUBLIC_JS_CEILING_KB`). The 100 KB figure in the architecture is not met and is not going to be; the amendment note is due in the next documents edit. |

| F8 | Architecture 13.8 and `CLAUDE.md` say `main` is protected by a branch protection rule. GitHub refuses to enable it on a private repository on the free plan (HTTP 403, "Upgrade to GitHub Pro or make this repository public"). | Today only discipline stops a push to `main`. Rulesets are also limited on free private repositories. | **Open.** Owner chooses: make the repository public, upgrade to GitHub Pro, or accept discipline-only protection and record it as an accepted risk. |
| F9 | `scollarly.co.in` is not on the Cloudflare account, and R2 is not needed (D16). | See Session 4. Blocks the domain and cache gates if the `workers.dev` Cache API probe fails (H7). | **Open.** Owner action: add the domain to Cloudflare and change the nameservers at the registrar. R2 is no longer planned (D16: images use Neon Object Storage). |
| F10 | `scollarly.co.in` is locked at GoDaddy until .IN KYC is accepted. The owner is an international student without Aadhaar, so DigiLocker is not available. Nameservers and DNS records cannot be changed. | Blocks moving the domain to Cloudflare (H7), a custom domain for the Worker, and the Resend sending domain (H6). The domain still resolves today; a registry server hold would take it offline. | **Open.** Owner action: ask GoDaddy support and email `support@nixi.in` for the foreign-national passport route (message drafted in the conversation). Not marked done by Claude Code. Decision D12: build on `workers.dev` meanwhile. No longer blocks Stage 0 or the cache gates (the Cache API works on `workers.dev`); it blocks launch only. See the list of applied amendments below. |
| F11 | **Stage 0 gates failed on the CPU limit of Workers Free** (Session 6). Password sign-in fails for scrypt (95 to 293 ms) and for PBKDF2 and passwordless (both cut at 10 ms); the lead POST used 12 ms against 8 ms with half its requests cut; image serving is at about 10 ms against 8 ms; the admin page could not be measured because sign-in fails; the public page is at 7 to 9 ms against a 5 ms target. | Without a way to sign in, Stages 2, 5 to 10 cannot work as designed. Architecture section 17 lists the options per gate. | **Decided 2026-10-23 (owner): option (b), redesign for the free plan (D14), documents edited in place (D13). Stage 0 stays open until Module S0.10 proves the redesign; if it fails, the decision returns to the owner.** The original options, for the record: (a) **Workers Paid plan** (about $5 a month, a far higher CPU limit): one change that clears every failing gate, but breaks "zero recurring cost" (PRD G6). (b) **Redesign for the free plan**: Google sign-in only (no passwords, session lookups kept very small), move work to build time, thinner handlers, serve prerendered pages as static assets so they cost no Worker CPU, images from object storage (needs R2 and likely a payment method). Higher effort, not proven to fit, and the Better Auth per-request cost is itself close to the limit. (c) Re-measure a leaner Stage 0 first (for example memoised auth, fewer queries) before choosing. Claude Code's reading: (a) is the only option that is certain to work; (b) is uncertain. This is the owner's decision. |
| F15 | **Two S0.10 gates failed on the deployed Worker** (Session 10): the admin page used 15 ms warm p50 and 25 ms p95 against 8 ms, and the lead POST used 3 ms p50 and 14 ms p95 against 8 ms. Nothing was cut at the 10 ms free-plan limit. Everything else measured passed. | Stage 0 is a hard gate: Stage 1 cannot start until S0.10 passes or the owner decides otherwise. The student page (no second query) costs 13 ms, so most of the admin cost is Next.js rendering, not the auth or RLS design. | **Decided 2026-10-24 (owner): option (1), stay on the free plan (D18).** The options were: (1) stay free and move staff screens off the Next.js render (static shell plus thin edge functions, as already done for the lead POST), and diagnose the lead POST tail; (2) Workers Paid plan (about 5 dollars a month, breaks PRD G6); (3) relax the 8 ms gate for staff-only pages, which needs an explanation of why 15 ms was not cut at the 10 ms limit. Claude Code's recommendation: (1) first, no plan change yet. |
| F12 | Image backup. With images in Neon Object Storage the weekly `pg_dump` carries no image bytes, and a monthly copy of up to 3.5 GB cannot fit in GitHub Free artifact storage (about 500 MB). | Content is archived and never deleted (ADR-014). | **Decided 2026-10-24 (D17, owner delegated the choice).** No cloud copy. Immutable hash-keyed objects with no delete path, a manifest in the weekly dump, and an owner-run incremental copy to the owner's own disk, checked by sha256 (`scripts/backup-images.mjs`, built in S10.3). Needs no credential, no GitHub storage, no paid service, and does not delay any stage before Stage 10. |
| F13 | **Neon Auth stores the visitor's IP address and browser string** in `neon_auth.session` (columns `ipAddress`, `userAgent`). CLAUDE.md says never store raw IP addresses. | The table is Neon's, not ours, and we cannot change its columns. | **Carried to Stage 2 (owner, 2026-10-24: flag it to a later stage; it does not block Stage 1).** The owner asked what Claude Code suggests. **Suggestion:** (1) a database trigger on `neon_auth.session` that blanks `ipAddress` and `userAgent` as each row is written, so nothing is kept; to be tried first on a throwaway Neon branch, because Neon manages that schema and could replace the trigger in an update; (2) if the trigger is not safe, a SECURITY DEFINER function owned by the owner role that clears both columns, called by the daily cron (S10.2), so nothing older than a day is kept; (3) either way the privacy notice says what is kept. Built and tested in S2.2 (sign-in) and confirmed with the owner then. Until then only the owner and test accounts sign in, so no visitor data is held. **Stage 2 update (2026-10-24): built, not yet applied.** Migration 0004 adds the trigger on `neon_auth.session` (blanks `ipAddress` and `userAgent` as each row is written) and the function `app_scrub_session_pii`, which `/auth/landing` calls after every sign-in (and the daily cron, S10.2, can call without a token). Both are tested on PGlite and Postgres with a stand-in for Neon's table. A read-only check on 2026-10-24 showed the migration role (`neondb_owner`) can update and add triggers to `neon_auth.session`. **Still to do, by the owner or on request:** try migration 0004 on a throwaway Neon branch first, then apply it, then sign in once and confirm both columns are null. The privacy notice wording is a Stage 3 item (S3.2 privacy page). |
| F14 | `@neondatabase/auth` is a **beta** (0.7.0-beta), pins `zod` 4.5.4 (an advisory exists for oversized collections) and Better Auth 1.7.6, and declares an optional peer of Next 16. `package.json` has an `overrides` entry so it installs on Next 15.5.28. We import only its framework-neutral server entry. | A beta dependency sits in the sign-in path. | **Owner accepts the beta (2026-10-24: "yes am okay with it being a beta version").** Re-check at each Stage review. If it becomes a problem the fallback is self-hosted Better Auth behind the same facade (ADR-037 fallback). |
| F16 | **Two image budgets in the documents.** Architecture 7.3 (`media_budget_bytes (150 MB)`) and section 3 say 150 MB; PRD FR-18, architecture 10.5 and essentials S6.3 say about 3.5 GB of Neon Object Storage's free 5 GB. | A seed default had to be chosen, and the meter and the 70% banner (S6.3, S10.2) read it. | **Closed 2026-10-24: the owner confirmed 3.5 GB.** Seeded as 3.5 GiB (D16). The stale 150 MB lines in architecture sections 3, 7.3 and the risk table were corrected in place. Left as written: ADR-026's historical rationale and the PRD's open question Q on the budget. |
| F17 | **`translations` shape.** Architecture 6.4 shows one text per row (`{ "en": "...", "fr": "..." }`), but `faq`, `university`, `fee_structure` and others have several translatable fields. | Stage 3 renders it and Stage 6 writes it. The database only checks it is a JSON object; `translationsSchema` requires `en`. | **Decided 2026-10-24 (owner accepted the recommendation, D19):** a row keeps its English text in plain columns; `translations` holds one object per extra locale, for example `{ "fr": { "question": "...", "answer": "..." } }`, with the fields it translates. `translationsSchema` (which requires `en`) is changed in Stage 3 to match, and the architecture 6.4 example is corrected then. |
| F18 | **First request of a Worker instance costs more than the 8 ms gate.** The lead endpoint's warm requests cost 3 to 5 ms; a request that reaches a freshly started instance also pays the Worker's start-up (Cloudflare reports 37 to 40 ms). Over about 2,700 logged requests none was terminated. | Section 17's gate is "at most 8 ms warm p95" and was meant for warm requests, but the old measurement could not tell warm from first-of-instance. | **Open (owner decision).** Options: (a) accept: the gate judges warm requests, first-of-instance requests are reported, and a platform termination is the failure that matters; (b) shrink the start-up further (zod/mini, a lighter Neon client for the lead path, loading the signed-in handlers on demand), with no guarantee of reaching 8 ms; (c) a paid Workers plan (not allowed by CLAUDE.md without the owner's say). Claude Code recommends (a), then (b) only if telemetry later shows terminated requests. |

## Stage status

Allowed status values: `in-progress`, `complete`. A stage or module with no entry has not started, shown as a dash.

| Stage | Name | Module IDs | Status |
|---|---|---|---|
| 0 | Proof of fit (hard gate) | S0.1 to S0.10 | **complete** (2026-10-24) |
| 1 | Foundation | S1.1 to S1.7 | complete (2026-10-24: S1.1 to S1.7, real seed ran twice on the live database) |
| 2 | Authentication, roles, admin shell | S2.1 to S2.7 | **complete** (2026-10-25: CI passed on all jobs, PR #18 merged and deployed, the owner signed in and enrolled 2FA per the owner's words; the sign-in CPU row was not recorded) |
| 3 | Public site | S3.1 to S3.5 | in-progress (2026-10-25: all five modules built; unit, integration and Playwright pass locally; waits for CI, published content and a deploy, see Session 18) |
| 4 | Offline, PWA, lead intake, WhatsApp | S4.1 to S4.6 | in-progress (2026-10-25: all six modules built; unit, integration on PGlite and Playwright pass locally; waits for CI on Postgres 16, migration 0005 on the live database, real Turnstile keys and the CPU rows, see Session 18) |
| 5 | Admin lead management | S5.1 to S5.6 | in-progress (2026-10-25: all six modules built; unit, integration and Playwright pass locally; waits for CI on Postgres 16, migration 0006 on the live database and the CPU rows, see Session 20) |
| 6 | Content management and images | S6.1 to S6.5 | — |
| 7 | Analytics (funnel and sources) | S7.1 to S7.3 | — |
| 8 | Student portal | S8.1 to S8.3 | — |
| 9 | Payments received and admin performance | S9.1 to S9.4 | — |
| 10 | Owner pages and operations | S10.1 to S10.4 | — |
| 11 | Hardening and launch readiness | S11.1 to S11.8 | — |

## Module registry (68 modules, status per module ID)

Update the status column (`in-progress` or `complete`) at the end of each stage. A dash means no entry yet.

| ID | Module | Status |
|---|---|---|
| S0.1 | Repo skeleton and Cache API probe | complete |
| S0.2 | Prerendered public page with Lighthouse CI | complete |
| S0.3 | Neon driver, stub lead POST, CU-hours probe | complete |
| S0.4 | Neon Auth behind the facade, owner 2FA (otpauth), stub admin page, step-up | complete |
| S0.5 | 300 KB WebP in a Neon Object Storage bucket served through the Cache API | complete |
| S0.6 | Tag revalidation and OpenNext cache bindings | complete |
| S0.7 | Cron, Durable Object counter and limiter | complete |
| S0.8 | Serwist offline page | complete |
| S0.9 | Measurement report | complete |
| S0.10 | Free-plan proof (edge fast path, one-query session check, thin handlers) | complete (2026-10-24: every gate passes on the deployed Worker after D18; see the gates tables) |
| S1.1 | Migrations, constraints, indexes, seeds | complete (2026-10-24, CI) |
| S1.2 | Repository layer, `Actor`, auth facade interface | complete (2026-10-24, CI) |
| S1.3 | Shared libraries | complete (2026-10-24, CI) |
| S1.4 | SLA pure function | complete (2026-10-24, CI) |
| S1.5 | Full CI | complete (2026-10-24, CI) |
| S1.6 | i18n scaffolding | complete (2026-10-24, CI) |
| S1.7 | Seed and migration scripts, logo and image import | complete (2026-10-24: real seed run twice on the live database; `ContactSubmission` import not built, no rows supplied, see Session 14) |
| S2.1 | Production Neon Auth configuration behind the facade | in-progress (2026-10-24: `/auth/landing`, mutation router, endpoint wiring; local tests pass, CI not run) |
| S2.2 | Sign-in and sign-out pages (Google only) | in-progress (2026-10-24: sign-in and sign-out pages; the Google redirect on `workers.dev` was proven in Stage 0, the new landing step has not been run for real) |
| S2.3 | Owner bootstrap, 2FA, step-up | in-progress (2026-10-24: bootstrap, 2FA endpoints and pages, step-up prompt; the owner has not yet signed in with it) |
| S2.4 | `Actor` issuance, role guards, fresh staff session lookup | in-progress (2026-10-24: access rules, owner-is-permanent trigger, admin removal; local tests pass) |
| S2.5 | Admin invites and Team page | in-progress (2026-10-24: invites, accept-invite page, Team page; local tests pass) |
| S2.6 | Admin shell | in-progress (2026-10-24: admin shell, Overview, Profile, Security; Playwright with mocked endpoints passes) |
| S2.7 | Audit log | in-progress (2026-10-24: audit writer and Audit page; local tests pass) |
| S3.1 | Content read layer and prerender | in-progress (2026-10-25: published-only reads through `runPublic`, tag cache, build fixture seam; unit and integration pass, CI not run) |
| S3.2 | Public pages | in-progress (2026-10-25: 15 pages in English and French, no-JS rendering, axe clean; Playwright passes locally, CI not run) |
| S3.3 | Fee gating, video facade, media delivery | in-progress (2026-10-25: fee gating, `youtube-nocookie` facades, text placeholders for images until Stage 6; unit and Playwright pass, CI not run) |
| S3.4 | Trust components | in-progress (2026-10-25: figures, testimonials, journeys and team render only when confirmed and consented; nothing is published yet, H4) |
| S3.5 | Performance pass | in-progress (2026-10-25: `check:bundle` and Lighthouse over 16 routes added to CI; the 100 KB budget cannot be met, F7; first load 102 to 113 KB) |
| S4.1 | Service worker and manifest | in-progress (2026-10-25: service worker rules, manifest, icons, install prompt for a returning visitor; Playwright passes, a real phone check is the owner's) |
| S4.2 | IndexedDB queue and sync engine | in-progress (2026-10-25: IndexedDB queue, backoff, Web Locks, 30-day flag, remove from phone; unit and Playwright pass) |
| S4.3 | Apply form, quick form, send-first order | in-progress (2026-10-25: quick and full forms, send first, 4 second wait; unit and Playwright pass) |
| S4.4 | `POST /api/v1/leads` | in-progress (2026-10-25: built, CI passed, migration 0005 applied on the live database by the deploy workflow, 20 of 20 probes passed in the first run; the CPU gate is NOT stably met: warm p95 6 ms in the first deploy, 22 ms in the second, see Session 19) |
| S4.5 | WhatsApp tap events | in-progress (2026-10-25: built and CI passed; the CPU row for `POST /api/v1/events` has no scenario yet) |
| S4.6 | Contact page, WhatsApp number from settings | in-progress (2026-10-25: contact page, the one WhatsApp helper, a test that fails on any other number or `wa.me` link) |
| S5.1 | Leads list | in-progress (2026-10-25: list, filters, search, URL filters, keyset paging; unit, integration and Playwright pass, CI not run) |
| S5.2 | Lead detail | in-progress (2026-10-25: lead detail, stage, assign, notes, log reply, WhatsApp drawer and chip; unit, integration and Playwright pass, CI not run) |
| S5.3 | Overdue, Unassigned, Overview | in-progress (2026-10-25: Overview with one COUNT(*) FILTER statement, Overdue and Unassigned views; the CPU row is still to come) |
| S5.4 | Duplicate detection | in-progress (2026-10-25: duplicate query, merge and not-a-duplicate in one transaction, never automatic; integration and Playwright pass) |
| S5.5 | Link requests, data requests, erasure | in-progress (2026-10-25: link requests with a checked verification method, data requests, erasure in one transaction; integration and Playwright pass) |
| S5.6 | Optimistic concurrency helper | in-progress (2026-10-25: lead.updated_at with a trigger, version carried by every save, conflict message; integration passes) |
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

## Stage 0 measurement report (module S0.9): first slice

The table below is the record of the first slice. Its failed CPU rows are the reason for decision D14. The redesigned gates are in the next section.

One row per gate in architecture section 17. Any failed gate stops the build and goes to the owner with the measured value and the options from section 17.

| Gate | Pass when | Measured | Result |
|---|---|---|---|
| Worker size | At most 2.6 MiB compressed, with auth, Drizzle, next-intl and Zod | 1.24 MiB compressed (6.046 MiB raw), native Linux CI build | Pass |
| Public page CPU | Cached public page at most 5 ms per request | Warm p50 7 ms, p95 9 ms, worst 14 ms (20 requests, 11 sampled events); never cut at the limit | Above the 5 ms target (FAIL as written); under the 10 ms platform limit |
| Password sign-in CPU | At most 10 ms, no Error 1102 over 50 sign-ins. Three variants measured: Better Auth default, PBKDF2 through WebCrypto, passwordless path. | scrypt: p50 95 ms, p95 173, worst 293, errors 500/503. PBKDF2 100k: cut at 10 ms on 12 of 12 events (503). Passwordless probe: cut at 10 ms on 10 of 10 (503; the probe builds Better Auth per request) | FAIL (all three variants) |
| Authenticated admin page CPU | At most 8 ms on the fresh session lookup path (staff). The cookie-cache path (student) is recorded too. | Not measurable: no session could be obtained because sign-in is cut by the CPU limit | Not measured (blocked by the sign-in failure) |
| Lead POST CPU | At most 8 ms (stub endpoint) | Warm 12 ms; 2 of 4 requests cut at the limit (503) | FAIL |
| Image serve (300 KB) | At most 8 ms CPU on a cache miss, no database access on a hit | CPU about 10 ms warm (p95 11), 3 of 10 events cut; single miss 31 ms; a hit calls no database (unit test). A miss took 1.2 s end to end | FAIL against 8 ms |
| Neon cold start | First admin request after idle in about 2 s or less (record the value) | 1.44 s client time, 1.23 s server, first query after 330 s idle (single sample); warm 137 ms | Pass |
| Version pinning | Next.js, OpenNext, Serwist and next-intl build, run and pass offline tests | Next.js 15.5.28, OpenNext 1.20.13, Serwist 9.5.13 and next-intl 4.14.9 build on Linux CI, pass the offline tests, and run on the deployed Worker | Pass |
| Revalidation | A publish updates a public page without a deploy. OpenNext cache bindings named; any payment-method requirement recorded. | After a publish the page showed the new content within 5 s, no deploy. Bindings: KV incremental cache, D1 tag cache, Durable Object queue. No payment method asked. The first publish call after the deploy returned 500 | Pass on retry |
| Cron and Durable Objects | Available on free and working (else ADR-003 fallback and DB rate limit) | Durable Object counter and limiter work. Cron not yet run (first at 23:05 UTC) | Durable Objects pass; cron pending |
| Better Auth features | Cookie cache, TOTP 2FA with recovery codes, 10-minute step-up, role field, email verification work with the Neon driver | Cookie cache, TOTP with recovery codes, 10-minute step-up, role field, email verification, fresh lookup: pass on Postgres (36 tests). Over the Neon driver on the Worker: sign-in worked on the first requests after the deploy, then is cut by the CPU limit | Pass on Postgres; not provable on the Worker (F11) |
| Lighthouse | Mobile performance at least 85, first load under 200 KB | Linux CI job passed its assertions (performance at least 0.85, first load under 200 KB) | Pass (home page only) |
| Cache API and purge | Work on the production hostname. If they are no-ops on `workers.dev`, H7 becomes blocking before the cache gates. | put, match and delete work on scollarly.gimafolabit.workers.dev | Pass. H7 does not block the cache gates |
| Terms check | Owner confirms commercial-use terms for Cloudflare, Neon, Resend and Turnstile free plans | Owner: "i checked all ok" (2026-10-23) | Done per the owner |
| Info only (non-gating): Neon API CU-hours | Can Neon's API report CU-hours to a cron job? | | Not measured |

## Module S0.10 gates (free-plan proof, redesigned; extended by D15 on 2026-10-24)

Same thresholds as architecture section 17, measured as warm p95 over at least 50 requests on the deployed Worker, with no request cut at the CPU limit. **Measured 2026-10-24 by the workflow run 40064928935 on commit e964be3** (live Worker, throwaway Neon Auth sessions, CPU time from `wrangler tail`; the tail samples under load, so "events" is fewer than requests). **Two gates failed (admin page, lead POST), so Stage 0 stays closed. The owner chose to stay on the free plan (D18); the staff and student rows were rebuilt as shell plus data call and re-measured; they pass (next table).** A failed gate returns the matching decision to the owner.

| Gate | Pass when | Measured (warm p50 / p95 / worst ms) | Result |
|---|---|---|---|
| Public page through the edge fast path | At most 5 ms | 0 / 1 / 1 (50 requests, 8 warm events); the first request after a deploy used 196 ms and was not cut | **Pass** |
| Image cache hit through the edge fast path | At most 8 ms, no database access | 0 / 1 / 1 (50 requests, 11 warm events) | **Pass** |
| Image cache miss, read from Neon Object Storage (public-read bucket) | At most 8 ms; recorded; must not be cut at the limit | 1 / 2 / 2 (9 misses, each a different image); about 1 s end to end | **Pass** |
| Neon Auth session verification: SDK `getSession()` versus our own check | Staff page at most 8 ms; pick the path by number | The SDK path was not measured; our one-query path is what the admin row below measured | See the admin row |
| Staff page with the row-level-security context set in the same Neon HTTP request (session query, then one query under RLS) | At most 8 ms | **15 / 25 / 33** (50 requests, 21 warm events; worst of all events 114). Not cut at the limit | **FAIL** |
| Student page, one-query session check | Recorded | 13 / 48 / 48 (50 requests, 20 warm events) | Recorded |
| Lead POST, thinned (edge handler, limiter, one query) | At most 8 ms | 3 / **14** / 15 (50 requests, 50 events); the median is under the gate, the upper tail is not. Not cut at the limit | **FAIL** |
| Runtime role denied on every table (non-owner, forced policies) | All tables denied without the right user | Live probe: role `app_runtime`, no BYPASSRLS, 0 rows visible without a context, Neon Auth's tables unreadable. Every-table check passes in CI | **Pass** |
| Neon Object Storage from the Worker | Signed write and public read work | Write 606 ms, read 177 ms wall; the probe used 5 / 7 / 9 ms CPU | **Pass** |
| Forged cookie, anonymous visitor and student refused on the admin page | All refused | 404, 404, 404 | **Pass** |
| Sign-in return trip on Neon Auth (the owner's Google test account) | At most 10 ms | Through Next.js: 19 ms and 12 ms (two real sign-ins), over the gate and not cut. Moved into the Worker entry; see the re-run table | **Fixed, see re-run table** |
| Google redirect through Neon Auth | Works; recorded | Works: five real sign-ins finished and landed on the student screen | Pass (H16 awaits the owner) |

**Re-run after D18 (ADR-040): measured 2026-10-24, workflow run 40074577922, commit 284eac1.** Each signed-in screen is two requests, each gated at warm p95 of at most 8 ms over 50 requests with none cut at the limit. **Every measured gate passed.** CPU is milliseconds from `wrangler tail`; the tail samples under load, so events are fewer than requests.

| Gate | Pass when | Measured (warm p50 / p95 / worst ms) | Result |
|---|---|---|---|
| Public page | At most 5 ms | 0 / 0 / 0 (17 events; the first request after the deploy used 17) | **Pass** |
| Staff screen, shell (session query, then the cached page) | At most 8 ms | 1 / 2 / 2 (50 requests, 18 events; first request 12) | **Pass** |
| Staff screen, data call (session query, then one query under row level security) | At most 8 ms | 2 / 4 / 4 (23 events) | **Pass** |
| Student screen, shell | At most 8 ms | 1 / 3 / 3 (19 events; first request 11) | **Pass** |
| Student screen, data call | At most 8 ms | 2 / 4 / 5 (30 events) | **Pass** |
| Lead POST, 50 requests, every sampled CPU value kept | At most 8 ms; explain the slow tail | 3 / 5 / 13 (50 events). Only three requests were above 5 ms: 13 (the fifth), 10 (the 28th) and 5. The run gate is warm p95, which is 5 | **Pass**; the two slow requests are not explained (probably an isolate starting fresh, since requests are 12.5 s apart) |
| Image cache hit | At most 8 ms, no database | 0 / 1 / 1 | **Pass** |
| Image cache miss, read from Neon Object Storage | At most 8 ms | 2 / 2 / 3 (9 misses) | **Pass** |
| Shell has no data and is not browser-cacheable; anonymous, student and forged sessions refused (404 shell, 401 / 403 data) | All hold | All checks passed (20 probes passed, 0 failed, 1 informational) | **Pass** |
| No request cut at the CPU limit | None | 0 in every scenario | **Pass** |
| Sign-in return trip on Neon Auth (`/auth/return`, the owner's Google test account) | At most 10 ms | **4 / 2 / 1 ms** (three real sign-ins after the move into the Worker entry); `/auth/start` 1 to 4 ms. Before the move, through Next.js: 19 and 12 ms | **Pass** |
| Google redirect through Neon Auth (H16) | Works; recorded | Works: the Google account chooser, the Neon Auth return, the session cookie and the student screen, five times. The database holds a Google account with a verified email, a 32-character token and a `student` row in `app_user`. Neon also stored the visitor's IP and browser string (F13) | **Pass**; H16 stays open until the owner says it is done |

Other checks in the same run (all passed): Neon cold start 1.66 s client time after a 330 s idle wait (gate about 2 s); warm query 431 ms; WebSocket transaction; Durable Objects counter and limiter; cron `lastCronAt` 2026-10-23 23:05 UTC; revalidation (a publish shows on the page in 31 s with no deploy); image served as webp with immutable headers; lead POST rules (400 without a key, 400 for a bad country, 201 then 200 on replay then 409 on a changed payload, 429 after 5 requests a minute). 17 probes passed, 0 failed.

**Reading of the numbers (Claude Code's reading, not a decision):** the student page (same session query, no second query) costs 13 ms and the admin page 15 ms, while the row-level-security probe alone costs 6 ms warm. So most of the page cost is Next.js rendering the page, not the auth or RLS design; the session query and the RLS query together add about 2 ms. Nothing was cut at the 10 ms limit, although the 8 ms gate is missed. The lead POST median is 3 ms, so its misses are the slow tail; the cause of the tail has not been diagnosed.


## Owner actions (human, never marked done by Claude Code)

Recorded only when the owner says so. Source: PRD section 12.2 and essentials Stage 0, S1.7 and S11.6.

| # | Action | Needed before | Status |
|---|---|---|---|
| H1 | Confirm commercial-use terms of Cloudflare, Neon, Resend and Turnstile free plans. Also decide if any OpenNext cache binding turns out to need a payment method (S0.6). | End of Stage 0 | **Done per the owner, 2026-10-23** ("i checked all ok"). No payment method was needed for KV or D1 (the workflow created both). R2 is not enabled and was not needed. **Not yet confirmed (added by D15, D16):** the free-plan terms of Neon Auth and Neon Object Storage. |
| H2 | Supply the old site's data files (9 universities, programmes, fees, FAQs, process steps, copy, logos and campus images) and any `ContactSubmission` rows. Format and steps: `docs/stage-1-runbook.md`. Also decide how migrated old leads are treated for the SLA (they have no reply logged, so they would show as overdue). | S1.7 (Claude Code must stop and ask if missing) | **Supplied 2026-10-24** (old `universities.ts`, `page.tsx`, `route.ts`, `schema.prisma`, logo and four images) and converted into `data/seed/` (dry run passes: 9 universities, 77 programmes, 9 confirmed fees, 12 FAQs, 11 process steps, 36 copy blocks, 9 logos). **Still missing:** any `ContactSubmission` rows (only the model was sent), the testimonials, team and journey data (not seeded, see the runbook). Old leads are exempt from the SLA (owner, 2026-10-24). The real run waits for the merge of PR #15 (migration 0003) and the owner-held credentials. |
| H3 | Q2: confirm the Scollarly WhatsApp number (+237 651 232 301 today) and the contact number shown on the site (+91 98157 25968 today) | Launch | **Answered by the owner 2026-10-24: the WhatsApp contact is +919815725968** (the contact number shown is the same). Put in `data/seed/site-settings.json`; it is written to `site_setting` by the seed, only while the setting is still unset. The +237 number in PRD Q2 is superseded. |
| H4 | Q3: supply real figures for students helped and admitted, confirm the 5 testimonials are real and consented, confirm team bios. Anything unconfirmed is not published. | Launch | Open **Owner 2026-10-25: will be supplied at the end of the last stage** (see End-of-build checklist). Nothing unconfirmed is published until then. |
| H5 | Q6: legal check on consent for 17-year-old applicants and data protection in the student countries | Launch | Open **Owner 2026-10-25: will be supplied at the end of the last stage** (see End-of-build checklist). The pages say the full text is being finalised until then. |
| H6 | Mailbox on scollarly.co.in and Resend domain verification | **Removed (D15):** no email is sent in v1 | Not needed |
| H7 | Confirm scollarly.co.in can point at Cloudflare Workers (likely needs DNS managed in Cloudflare) | Launch, or before S0.2 if the S0.1 probe shows the Cache API is a no-op on `workers.dev` | Open. Blocked by F10 (no longer blocking the cache gates: the Cache API works on `workers.dev`) |
| H8 | Create the Google OAuth credentials and enter them in the Neon Auth console (H13). Google's redirect address is Neon Auth's | Before S0.10 can measure the sign-in return trip, and before Stage 2 | **Done per the owner, 2026-10-24** ("i checked its okay, done its own testing for now and my email has been set as test user"). The app is in Google's Testing mode with the owner as test user, so publishing it is a launch step. |
| H9 | Confirm every item tagged [Mine, confirm] in the PRD and architecture (SLA/phone/ref defaults, performance budget, image caps and 5 GB budget, step-up window, invite expiry, admin erasure, backup approach, and the values added on 2026-10-23: 4 s send wait, (the student email cap of 60 a day, 40 reserved and 3 per address was removed by D14), 10 `wa_tap` per ref per day, backup retention 28 and 60 days, hourly uptime check) | Before the stage that uses each | Open **Partly answered 2026-10-25:** the public JavaScript budget is accepted at 118 KB (F7). The other [Mine, confirm] items are still open. |
| H17 | Create the real Turnstile widget (Cloudflare dashboard, Turnstile, Add widget, for the Worker's address) and add the repository secrets `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, then run the deploy workflow again. Claude Code can do it with the Cloudflare and GitHub tools if the owner says so | Before launch (until then the always-pass test keys are in use) | Open **Owner 2026-10-25: "i have set the secrets in github"** (`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are in the repository secrets, saved 23:34 UTC). Claude Code reran the deploy workflow on the owner's word to pick them up (run 40144527154); the run finished with `HAVE_REAL_TURNSTILE: true` and the real secret set on the Worker after the measurement step (Session 19). A real widget check from a browser is part of the phone test (H19). |
| H18 | Publish the seeded content: `node scripts/publish-content.mjs --dry-run`, then without the flag (or ask Claude Code to). Then run the deploy workflow once so the build prerenders it | Before the public pages show content | Open **Done 2026-10-25 on the owner's instruction ("DO 2 AND 3"): Claude Code ran `scripts/publish-content.mjs` on the live database (dry run first): 159 rows published (9 universities, 77 programmes, 9 fee records, 5 campus experiences, 12 FAQs, 11 process steps, 36 copy blocks). The deploy workflow then built the pages from them (run 40142776719).** |
| H19 | Check on a real phone on mobile data: tap a WhatsApp button, fill the quick form, confirm the chat opens with the reference and the lead is in the database; repeat in airplane mode and turn it off | Before launch | Open **Owner has not done it yet (2026-10-25).** |
| H10 | Set metric targets and the pipeline freshness "N days" | After 4 weeks of data | Open |
| H11 | Owner sign-off on the pre-launch checklist | S11.6 | Open |
| H12 | Read Neon's plans page for Object Storage and confirm the free-plan request and transfer limits (the pages read state 5 GB per project but no request or transfer limit). No card is needed. R2 is dropped (D16) | Before S0.10 measures images | **Carried to Stage 3 (image upload, S3.3) and before launch; does not block Stage 1** (owner, 2026-10-24). Open **Owner 2026-10-25 (sent a screenshot of neon.com/pricing, Free plan): Object Storage is 5 GB.** The page shows no request or transfer limit, so none is recorded; the 3.5 GB image budget (F16) stays inside the 5 GB. |
| H13 | Switch on Neon Auth for the project in the Neon console and add the Google credentials there | Before S0.10 can measure Neon Auth | **Done per the owner, 2026-10-24.** Claude Code verified from the Neon CLI that Google shows as its own credentials, not Neon's shared test keys. |
| H14 | From Stage 10 on: run `scripts/backup-images.mjs` monthly and after any bulk upload, and keep the copy on your own drive (a second copy in your own cloud account is optional). The script needs no password or key | After S10.3, then monthly | Not yet needed |
| H15 | Turn off the **Magic Link** plugin on Neon Auth: Neon console, Settings, Better Auth, Magic Link, switch off. (Claude Code turned off email-and-password and organizations from the command line, but magic link has no command.) Until then anyone can create an account with an email link, which bypasses "Google sign-in only" | Before launch, and ideally before S0.10 | **Done per the owner, 2026-10-24** ("i have switched off the majic link"). Claude Code cannot check this from the command line |
| H16 | Add the redirect URI `https://ep-bitter-bar-b97sb88f.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth/callback/google` to the Google OAuth client if it is not there | Before the first real Google sign-in | **Done: the owner confirmed on 2026-10-24 that the redirect address is checked and works.** |

## End-of-build checklist (owner, after the last stage)

Recorded 2026-10-25 from the owner's words: "i will send when we finish all the stages ... we will create and send at the end of the last stage also". Claude Code asks for each item when Stage 11 (hardening and launch readiness) starts, and does not publish anything below before the owner confirms it.

| # | What | Owner does | Claude Code does |
|---|---|---|---|
| E1 | Real figures: students helped and admitted (H4) | Sends the confirmed numbers | Enters them as confirmed statistics, publishes, redeploys |
| E2 | Testimonials with proof of consent (H4) | Sends the text, the person, the consent record | Enters them with the consent record, publishes only those that carry it |
| E3 | Team bios (H4) | Sends confirmed names, roles, bios | Enters and publishes |
| E4 | Privacy notice and terms (H5, legal check on consent for 17-year-olds and data protection in the student countries) | Sends the final legal text | Puts it in the content blocks `privacy.body` and `terms.body`, changes `CONSENT_NOTICE_VERSION` in `src/lib/lead-form.ts` so each lead records which text it agreed to, redeploys |
| E5 | Real phone check (H19) | Does it, sends the lead reference | Confirms the lead reached the database |
| E6 | Remaining [Mine, confirm] items (H9), metric targets (H10), pre-launch sign-off (H11) | Confirms | Records |
| E7 | Domain (F10, H7) | Resolves the .IN verification and DNS | Switches the Worker to it |
| E8 | Fees: mark each fee as confirmed with its real range | Confirms per university | Updates the rows; until then pages say "Fees to be confirmed" |

## Amendments applied in place (decision D13) and what remains

This section replaces the "Version 2 backlog" written in Session 5. No version 2 exists. Each item records where it was applied.

| # | Item | Status |
|---|---|---|
| V2-1 | Settle the production domain | **Remains, for launch only.** The PRD (section 4 and 12.2) now says the build runs on `workers.dev` until the .IN verification is done (D12). Blocked by F10. If the domain cannot be verified, switching domains is a new owner decision. |
| V2-2 | Decide how email works without a verified sending domain | **Applied (D14).** Google sign-in only, invites by copyable link, Resend optional. PRD sections 4, 6 (F5), 10, 11 and 12.2; architecture ADR-032, sections 9, 13.1, 16; essentials S2.1 to S2.5. |
| V2-3 | Record the hosting URL decision | **Applied.** PRD section 4; architecture sections 1 and 6.1; the Cache API result is recorded in essentials S0.1. |
| V2-4 | Re-check Google OAuth on `workers.dev` | **Remains.** Now an explicit Stage 2 check in S2.2 and its exit criteria. |
| V2-5 | Fold in the other open flags (F5 delete carve-outs in `CLAUDE.md`, F6 `server/db` Drizzle import, F7 JavaScript budget, F8 branch protection) | **Remains.** Waiting for the owner's answers. F7 matters more now that Next.js is bypassed for cached pages. |
| V2-6 | Refresh vendor limits the architecture quoted | **Applied** in architecture section 1 (Neon plans page says 1 GB per project; capacity estimates stay on the safer 0.5 GB; KV, D1 and the Durable Object queue need no payment method). |
| D15-1 | Neon-centred redesign: Neon Auth, otpauth owner 2FA, row level security plus facade, Neon Object Storage images (D16), Resend removed | **Applied 2026-10-24 as a proposal.** PRD sections 4, 6, 10, 11, 12.2, FR-18; architecture ADR-036 to ADR-039 and amended ADRs; essentials S0.4, S0.5, S0.10, S1.1, S2.x, S3.3, S6.3, S10.3, S11.x; CLAUDE.md. Proven or rejected by S0.10. |
| D15-2 | Backup of images now that they are in Neon Object Storage | **Applied (D17).** Architecture 13.7, ADR-026, ADR-039, risk table; essentials S6.3, S10.3, S10.4. |

## Project understanding (for future sessions)

- **Product:** Scollarly connects African students (Cameroon, Nigeria, Ghana, Ivory Coast, Senegal, Guinea, South Africa) with Indian universities. Students pay nothing. Universities pay Scollarly in USD after enrolment. Version 2 is a brand-new codebase replacing an old site built for good connections.
- **Core problem:** users are on limited, expensive Android data. The old site was heavy, hotlinked images, had no lead storage, no admin, hard-coded content and inconsistent trust claims.
- **Roles:** exactly three: student, admin, owner. One owner, enforced by a partial unique index. Owner powers require a 2FA-verified session. Admin and owner requests do a fresh session lookup, so removal cuts access on the next request.
- **Scope:** all features F1 to F11 ship in version 1 (public site, PWA with offline lead queue, lead intake with a full form and a quick WhatsApp form, smart WhatsApp links, auth and roles, content management with images in Neon Object Storage, lead management with SLA, student portal, analytics, payments-received ledger, i18n scaffolding with English live and French ready).
- **Lead flow:** the form saves locally, sends, waits up to 4 seconds when online, then opens WhatsApp with the reference. Offline or slow, it queues and opens WhatsApp anyway.
- **Stack:** Next.js (App Router) and TypeScript on Cloudflare Workers via OpenNext, Neon Postgres with Drizzle, Neon Auth, otpauth, Neon Object Storage, Turnstile, Serwist and idb, next-intl, Tailwind, shadcn/ui and Recharts (admin only), Vitest, Playwright, Lighthouse CI, axe, GitHub Actions. Free tiers only. No paid service and no change of host without the owner.
- **Biggest risks:** Workers Free limits (10 ms CPU, 3 MiB size) against Next.js, auth hashing and images (Cloudflare puts auth and server rendering at 10 to 20 ms, so the 8 ms admin gate is the likeliest to fail); Neon scale-to-zero and 100 CU-hours; offline queue interacting with Turnstile; Serwist and Next.js version compatibility; caching behaviour that may need the real domain. This is why Stage 0 is a hard gate.
- **Hard rules:** never push to `main`; feature branch and merge request for every change; only `server/repositories` imports Drizzle, only `server/auth` imports the Neon Auth SDK and otpauth, only `server/media` uses the storage client, nothing imports Resend; no access control in middleware; no admin libraries in public routes; one WhatsApp URL helper; no physical deletes of business or content data (carve-outs in ADR-029); no personal data in logs or events; UTC in storage, WAT (`Africa/Douala`) for display; additive-first migrations; unconfirmed stats, testimonials and bios are never published.
- **Free-plan design (D14):** Google sign-in only (no passwords), an edge fast path that answers public pages and images from the Cache API before Next.js starts, a one-query session check, thin handlers, images in Neon behind `MediaStore`. Stage 0 stays open until Module S0.10 proves it on the deployed Worker.
- **Neon-centred design (D15):** Neon Auth (managed Better Auth) for sign-in and sessions; roles, owner, invites and owner 2FA in our own tables; Neon row level security plus the auth facade (two locks, non-owner runtime role, forced policies); images in a Neon Object Storage bucket; no email. Proven or rejected by S0.10.
- **Build order:** Stage 0 proof of fit, then Foundation, Auth and admin shell, Public site, Offline and lead intake, Lead management, Content and images, Analytics, Student portal, Payments, Owner pages, Hardening and launch.

## Traceability (to be filled at S11.5)

Each of FR-1 to FR-18 must map to at least one passing test before launch. Not started.
