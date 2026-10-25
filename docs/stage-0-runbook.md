# Stage 0 runbook: proof of fit

Written for the owner. Stage 0 is the hard gate in `essentials/system_architecture_essential_1.md`. Everything that can be
checked without a deployed Worker is built, tested, and runs in CI on every pull request. The remaining gates (CPU time,
the Neon cold start, the Cache API, cron, revalidation, the live database role, Neon Object Storage) are properties of the
platform, so they are measured by a manual GitHub Actions workflow that deploys the Stage 0 slice to the free `workers.dev` address.

The Worker cannot be built reliably on Windows (OpenNext), so **nothing is deployed from your PC**. The workflow builds on Linux.

## What the Stage 0 slice is (decisions D14, D15, D16, D17)

| Part | How it works |
|---|---|
| Sign-in and sessions | **Neon Auth** (Neon's managed Better Auth, schema `neon_auth` in our database). Google only. Our Worker proxies `/api/auth/*` to it and finishes the Google return trip at `/auth/return`. |
| Who may see what | The auth facade runs **one query per request** (`app_resolve_session`). Roles, the single owner, the owner's second factor and the step-up time are in our own tables. **Row level security** is a second lock: the Worker connects as the non-owner role `app_runtime`. |
| Owner 2FA | The `otpauth` library plus our own encrypted secret, recovery codes, lockout and replay refusal (`src/server/auth/second-factor.ts`). |
| Images | A **Neon Object Storage** bucket named `images` (public-read). The Worker reads an image with a plain fetch and caches it; uploads are signed with a write-only credential. |
| Speed on the free plan | The Worker entry (`worker/index.ts`) answers public pages and images from the Cache API, and runs `POST /api/v1/leads` as a plain function, before Next.js starts. |
| Email | None. Resend was removed (ADR-036). |

## What is verified on every pull request (no accounts needed)

| Check | How | Command |
|---|---|---|
| Strict types, lint, import boundaries | TypeScript strict, ESLint | `npm run typecheck`, `npm run lint` |
| Pure logic and handlers, including 2FA rules, the session cookie parser, the media store | Vitest unit tests | `npm test` |
| Migrations, row level security on every table, the one session query, owner bootstrap, 2FA against the real tables, idempotent leads | Vitest against a real Postgres (service container in CI, PGlite locally) | `npm run test:integration` |
| Next.js 15.5.28 + next-intl + Serwist build together | `next build` | `npm run build` |
| Worker bundle and its compressed size (at most 2.6 MiB) | OpenNext build, Wrangler dry run | `npm run build:worker` then `npm run size` |
| Offline page and never-cache rules | Playwright offline mode | `npm run test:e2e` |
| Mobile Lighthouse budget | Lighthouse CI | `npx lhci autorun` |

## One-time setup (free plans only)

**Repository secrets** in GitHub (Settings, Secrets and variables, Actions). Claude Code created the new ones straight from the Neon
command line without printing them; the rest you added earlier:

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Cloudflare access for the deploy |
| `PHASE0_DATABASE_URL` | Neon owner string, pooled. Used only to build the runtime string |
| `PHASE0_MIGRATION_DATABASE_URL` | Neon owner string, direct. Migrations, the runtime role, seeding |
| `PHASE0_RUNTIME_DB_PASSWORD` | Password of the non-owner `app_runtime` role |
| `PHASE0_NEON_AUTH_BASE_URL`, `PHASE0_NEON_AUTH_COOKIE_SECRET` | Neon Auth address and the secret that signs its cached cookie |
| `PHASE0_TOTP_ENCRYPTION_KEY` | Encrypts the owner's authenticator secret |
| `PHASE0_RATE_LIMIT_SECRET` | Salts the rate limiter's hashed caller key |
| `PHASE0_NEON_STORAGE_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | Neon Object Storage: address and a **write-only** credential |
| `PHASE0_PROBE_TOKEN`, `PHASE0_OWNER_EMAIL` | Stage 0 probe guard, and the owner's email |

In Neon (done): Neon Auth on, Google with your own credentials, email-and-password sign-in off, the organization plugin off, the Worker
address trusted. Still to switch off by hand: the **Magic Link** plugin (Neon console, Settings, Better Auth, Magic Link).
In Google Cloud: the redirect URI `https://<neon-auth-url>/callback/google` on the OAuth client.

## Running the deployed gates

GitHub, the repository, **Actions**, **Stage 0 deploy and measure**, **Run workflow** (branch `main`). Or: `gh workflow run stage0-deploy.yml --ref main`.
It takes about 45 to 60 minutes, most of it deliberate waiting (the Neon cold-start idle wait, and about 10 minutes of spaced-out lead requests so the rate limiter allows 50).

What the workflow does, in order:

1. Checks that every secret exists and the Cloudflare token is active.
2. Finds or creates the KV namespace and the D1 database for the OpenNext cache. **If Cloudflare asks for a payment method here, stop and tell the owner (G6).**
3. Applies the migrations to Neon over the direct connection, sets the password of the non-owner `app_runtime` role, and builds the Worker's connection string from it.
4. Uploads ten test images (about 300 KB each) to Neon Object Storage and checks they can be read with no credential.
5. Creates a throwaway admin and a throwaway student in Neon Auth's tables, with two-hour sessions (removed again at the end, even if the run fails).
6. Builds the Worker, enforces the 2.6 MiB size gate, deploys, and sets the Worker secrets (the real Turnstile secret from the repository secret `TURNSTILE_SECRET_KEY`; only if that secret is missing does the Worker get Cloudflare's always-pass test secret, and the run warns).
7. Runs `scripts/measure-cpu.mjs` (the Stage 0 functional probes script was removed on 2026-10-26, with the probe routes; the measurement posts leads with the `x-phase0-token` header, which skips Turnstile for the measurement only). Results go to the job summary and are saved as the `stage0-reports` artifact for 30 days.

| Gate | Where it is measured | Pass when |
|---|---|---|
| Cache API on `workers.dev` (S0.1) | probe `cache` | `putThenMatchWorks` is true |
| CPU: public page | CPU measurement | at most 5 ms warm p95 |
| CPU: staff screen, shell and data call (ADR-040), each request | CPU measurement, throwaway admin session | at most 8 ms warm p95 each, nothing cut at the limit |
| CPU: student screen, shell and data call, each request | CPU measurement, throwaway student session | at most 8 ms warm p95 each |
| CPU: lead POST, 50 requests | CPU measurement | at most 8 ms warm p95 |
| CPU: image cache hit, and first request from storage | CPU measurement | at most 8 ms; a hit makes no database access |
| Runtime role and row level security | probe `rls` | role `app_runtime`, no BYPASSRLS, no rows without a context, Neon Auth tables unreadable |
| Neon Object Storage | probe `storage` | a signed write and a public read both work from the Worker |
| Sign-in return trip on Neon Auth | **by hand, once** | see below |
| Neon cold start | probe `neon-http` after the idle wait | about 2 s or less (recorded) |
| Neon WebSocket transaction | probe `neon-ws` | returns 2 |
| Revalidation (S0.6) | publish probe, then poll the page | the page shows the new title with no deploy |
| Durable Objects (S0.7) | probe `do` | counter increments, limiter answers; the lead endpoint returns 429 on the sixth request in a minute |
| Cron (S0.7) | `lastCronAt` from probe `do` after 23:05 UTC | set |
| Lead intake over the real stack | probes | 400 without a key, 201 then 200 on replay, 409 on a changed payload |
| Auth on the real path | probes | the admin page renders for an admin session and returns 404 for an anonymous visitor, a student and a forged cookie |
| Neon CU-hours (non-gating) | probe `neon-cu` | recorded either way (needs the optional Neon secrets) |

### The Google sign-in return trip (by hand, once)

This needs a person. Open a terminal in the project, run `npx wrangler tail scollarly --format json`, then in a browser open the Worker address, start
Google sign-in with your own account, and finish. In the log, find the requests to `/api/auth/...` and `/auth/return` and note their `cpuTime`.
Record them in the tracker. The Worker only does the return trip; Google and Neon do the rest.

## After the gates are decided

1. Record every measured value in `tracker/tracker_1.md` (the Module S0.10 gates table).
2. Done on 2026-10-26 (tracker Session 28): the probe routes, `scripts/stage0-probes.mjs`, the stub lead intake and the `phase0_*` tables (migration 0007) are removed. The `admin/phase0` and `me/phase0` stub screens remain as the shell-plus-data-call fixtures. The throwaway probe users and measurement leads are removed by the workflow itself.
3. The owner confirms the commercial-use terms of Cloudflare, Neon (including Neon Auth and Object Storage) and Turnstile free plans (tracker H1, H12). Claude Code never marks this done.

## Why some things are the way they are

- **`server/db` may import Drizzle.** Architecture section 5 places the client factory and schema there. It is treated as the
  internals of the repository layer. If you read CLAUDE.md as "only `server/repositories`, literally", say so and the db files move under it.
- **Row level security protects against a missing check in our code, not against SQL injection**, because our own code sets the user for each query.
- **The Worker never gets Neon Auth's tables.** The runtime role has no grant on the `neon_auth` schema; the one session lookup is a database function that runs with the owner's rights.
- **Probe sessions are real rows in Neon Auth's tables** for throwaway users on the reserved `.invalid` domain, so the measured path is the real one.
- **KV is tested first for the OpenNext incremental cache** because it needs no payment method. OpenNext's own docs discourage it
  (eventually consistent, so stale pages can persist) and recommend R2. R2 asked for a payment method, so it is not used (decision D16).
- **The workflow runs only from `main`** (architecture 13.3), and only when started by hand.
