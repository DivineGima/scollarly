# Stage 0 runbook: proof of fit

Written for the owner. Stage 0 is the hard gate in `essentials/system_architecture_essential_1.md`. Everything that can be
checked without a deployed Worker is built, tested, and runs in CI on every pull request. The remaining gates (CPU time,
the Neon cold start, the Cache API, cron, revalidation) are properties of Cloudflare's platform, so they are measured by a
manual GitHub Actions workflow that deploys the Stage 0 slice to the free `workers.dev` address.

The Worker cannot be built reliably on Windows (OpenNext), so **nothing is deployed from your PC**. The workflow builds on Linux.

## What is verified on every pull request (no accounts needed)

| Check | How | Command |
|---|---|---|
| Strict types, lint, import boundaries | TypeScript strict, ESLint | `npm run typecheck`, `npm run lint` |
| Pure logic and handlers | Vitest unit tests | `npm test` |
| Schema, constraints, auth flows, 2FA, step-up, idempotency | Vitest against a real Postgres (service container in CI, PGlite locally) | `npm run test:integration` |
| Next.js 15.5.28 + next-intl + Serwist build together | `next build` | `npm run build` |
| Worker bundle and its compressed size (at most 2.6 MiB) | OpenNext build, Wrangler dry run | `npm run build:worker` then `npm run size` |
| Offline page and never-cache rules | Playwright offline mode | `npm run test:e2e` |
| Mobile Lighthouse budget | Lighthouse CI | `npx lhci autorun` |

## One-time setup (done by the owner, free plans only)

Seven **repository secrets** in GitHub (Settings, Secrets and variables, Actions): `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `PHASE0_DATABASE_URL` (Neon pooled), `PHASE0_MIGRATION_DATABASE_URL` (Neon direct),
`PHASE0_BETTER_AUTH_SECRET`, `PHASE0_PROBE_TOKEN`, `PHASE0_OWNER_EMAIL`. Optional, for the CU-hours probe:
`NEON_API_KEY` and `NEON_PROJECT_ID` (not yet wired into the workflow).

## Running the deployed gates

GitHub, the repository, **Actions**, **Stage 0 deploy and measure**, **Run workflow** (branch `main`). Or: `gh workflow run stage0-deploy.yml --ref main`.
It takes about 25 to 35 minutes, most of it deliberate waiting (the Neon cold-start idle wait and the CPU measurement).

What the workflow does, in order:

1. Checks that every secret exists and the Cloudflare token is active.
2. Finds or creates the KV namespace `scollarly-next-inc-cache` and the D1 database `scollarly-next-tag-cache`, and writes their IDs into `wrangler.jsonc` in the CI workspace only (never committed). **If Cloudflare asks for a payment method here, the step fails with a "PAYMENT METHOD REQUIRED?" message: stop and tell the owner (G6).**
3. Applies the database migration to Neon over the direct connection, and stores the 300 KB test image.
4. Builds the Worker, enforces the 2.6 MiB size gate, deploys, and sets the Worker secrets (Turnstile uses Cloudflare's documented always-pass test secret `1x0000000000000000000000000000000AA`, for measurement only).
5. Runs `scripts/stage0-probes.mjs` and then `scripts/measure-cpu.mjs`. Results go to the job summary and are saved as the `stage0-reports` artifact for 30 days.

| Gate | Where it is measured | Pass when |
|---|---|---|
| Cache API on `workers.dev` (S0.1, first) | probe `cache` | `putThenMatchWorks` is true. If false, **stop**: tracker H7 (domain on Cloudflare) becomes blocking before S0.2, S0.5 and S0.6. The domain is currently locked (tracker F10), so the architecture 17 fallback applies. |
| CPU: public page, sign-in x3 variants, admin (fresh lookup), student (cookie cache), lead POST, image serve | CPU measurement step | Public 5 ms, sign-in 10 ms with no `exceeded` outcomes, admin 8 ms, lead POST 8 ms, image miss 8 ms |
| Neon cold start | probe `neon-http` after the idle wait | about 2 s or less (the value is recorded) |
| Neon WebSocket transaction | probe `neon-ws` | returns 2 |
| Revalidation (S0.6) | publish probe, then poll the page | the page shows the new title with no deploy |
| Durable Objects (S0.7) | probe `do` | counter increments, limiter answers; the lead endpoint returns 429 on the sixth request in a minute |
| Cron (S0.7) | `lastCronAt` from probe `do` after 23:05 UTC | set |
| Lead intake over the real stack | probes | 400 without a key, 201 then 200 on replay, 409 on a changed payload |
| Auth over the Neon driver | probes | pbkdf2 and passwordless sign in; admin page renders for an admin and returns 404 for an anonymous visitor and for a student |
| Neon CU-hours (non-gating) | probe `neon-cu` | recorded either way (needs the optional Neon secrets) |

The cron trigger runs once a day at 23:05 UTC, so the `lastCronAt` value appears the day after the first deploy.
To check it sooner, run `npx wrangler dev --test-scheduled` locally once Wrangler can build, or wait for the next run and re-run the `do` probe.

## After the gates are decided

1. Record every measured value in `tracker/tracker_1.md` (the Stage 0 measurement report table).
2. Remove the Phase 0 probes before any real data exists: `src/app/api/v1/probe/`, `src/modules/phase0/`, `src/server/auth/probe.ts`,
   the `phase0*` tables (as a later additive-first migration, see architecture 14) and the probe users
   (`delete from "user" where email like '%@phase0.invalid'`). The probe users are throwaway test data, not business data.
3. The owner confirms the commercial-use terms of Cloudflare, Neon, Resend and Turnstile free plans (tracker H1). Claude Code never marks this done.

## Why some things are the way they are

- **`server/db` may import Drizzle.** Architecture section 5 places the client factory and schema there. It is treated as the
  internals of the repository layer. If you read CLAUDE.md as "only `server/repositories`, literally", say so and the db files move under it.
- **Probe password is derived from `PHASE0_PROBE_TOKEN`**, not written in code, because the probe users exist in the real database.
- **KV is tested first for the OpenNext incremental cache** because it needs no payment method. OpenNext's own docs discourage it
  (eventually consistent, so stale pages can persist) and recommend R2. R2 is not enabled on the account and may need a card, which is the owner's decision.
- **The workflow runs only from `main`** (architecture 13.3), and only when started by hand.
