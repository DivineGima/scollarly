# Stage 0 runbook: proof of fit

Written for the owner. Stage 0 is the hard gate in `essentials/system_architecture_essential_1.md`. Everything that can be
checked on a laptop has been built and tested. The gates marked **needs your accounts** can only be measured on a deployed
Worker, because CPU time, the Neon cold start, the Cache API and Cron are properties of Cloudflare's platform.

## What is already verified without any account

| Check | How | Command |
|---|---|---|
| Strict types, lint, import boundaries | TypeScript strict, ESLint | `npm run typecheck`, `npm run lint` |
| Pure logic and handlers | Vitest unit tests | `npm test` |
| Schema, constraints, auth flows, 2FA, step-up, idempotency | Vitest against a real Postgres engine (PGlite locally, a service container in CI) | `npm run test:integration` |
| Next.js 15.5.28 + next-intl + Serwist build together | `next build` | `npm run build` |
| Worker bundle and its compressed size | OpenNext build, Wrangler dry run | `npm run build:worker` then `npm run size` |
| Offline page and never-cache rules | Playwright offline mode | `npm run test:e2e` |
| Mobile Lighthouse budget | Lighthouse CI | `npx lhci autorun` |

## What you need to supply (one-time, free plans only)

1. **Cloudflare account**, then `npx wrangler login`.
2. **Create the two cache stores** OpenNext needs, and paste the IDs into `wrangler.jsonc` where it says `REPLACE_ME`:
   - `npx wrangler kv namespace create NEXT_INC_CACHE_KV`
   - `npx wrangler d1 create scollarly-next-tag-cache`
   - You do **not** create the `revalidations` table by hand: `npm run deploy` (OpenNext's populate-cache step) creates it and fills the KV cache.
   - **Record whether either command asked for a payment method.** That answer is the S0.6 "payment method" finding. If one did, stop and tell me (G6).
   - Note: OpenNext's own docs discourage KV for the incremental cache (it is eventually consistent, so stale pages can persist) and recommend R2 for revalidation. KV is tested first because it needs no payment method. If revalidation misbehaves, the fallback is R2, which may need a card, so that is your decision.
3. **Neon project** (free plan). Copy the connection string.
4. **Apply the migration** from your machine (never from the Worker):
   `MIGRATION_DATABASE_URL="<neon url>" npm run db:migrate`
5. **Seed the 300 KB test image** (S0.5): `DATABASE_URL="<neon url>" npm run phase0:seed-image`. It prints the `sha256`.
6. **Set the Worker secrets** (`npx wrangler secret put NAME`): `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ random characters),
   `BETTER_AUTH_URL` (the deployed URL), `OWNER_EMAIL`, `PHASE0_PROBE_TOKEN` (long random string),
   `TURNSTILE_SECRET_KEY` = **`1x0000000000000000000000000000000AA`** (Cloudflare's documented always-pass test secret, for measurement only).
   Optional: `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (needs tracker H8), `NEON_API_KEY`/`NEON_PROJECT_ID` (CU-hours probe).
7. **Deploy:** `npm run deploy`.

## Measuring each gate

All probes need the header `x-phase0-token: <PHASE0_PROBE_TOKEN>`; without it they answer 404.

| Gate | Do this | Pass when |
|---|---|---|
| **Cache API on `workers.dev` (first, S0.1)** | `curl -H "x-phase0-token: $T" https://<worker>/api/v1/probe/cache` | `putThenMatchWorks` is `true`. If `false`, **stop**: tracker H7 (domain on Cloudflare) becomes blocking before S0.2, S0.5 and S0.6. |
| CPU: public page, sign-in x3 variants, admin (fresh), student (cached), lead POST | `npm run measure -- --base https://<worker> --token $T --samples 50` | Public ≤ 5 ms, sign-in ≤ 10 ms with no `exceeded` outcomes, admin ≤ 8 ms, lead POST ≤ 8 ms |
| Image serve | `npm run measure -- --base ... --token $T --only media --media <sha256>` | ≤ 8 ms on a miss; a hit reads no database (unit-tested, and confirm the second call's CPU is lower) |
| Neon cold start | Leave it idle 6+ minutes, then `curl -s -o /dev/null -w "%{time_total}\n" -H "x-phase0-token: $T" https://<worker>/api/v1/probe/neon-http` | about 2 s or less (record the value) |
| Neon WebSocket transaction | `.../api/v1/probe/neon-ws` | returns `value: 2` |
| Revalidation (S0.6) | Open `/phase0/published`, then `curl -X POST -H "x-phase0-token: $T" "https://<worker>/api/v1/probe/publish?title=Hello"`, reload the page | The page shows "Hello" with no deploy |
| Durable Objects and Cron (S0.7) | `.../api/v1/probe/do` (counter and limiter work). After 23:05 UTC the same call shows `lastCronAt`; or trigger with `npx wrangler dev --test-scheduled` | Counter increments, limiter returns a decision, `lastCronAt` is set |
| Neon CU-hours (non-gating) | `.../api/v1/probe/neon-cu` (needs `NEON_API_KEY`, `NEON_PROJECT_ID`) | Record `available: true/false` |
| Better Auth features with the Neon driver | Sign in as the probe users, enrol 2FA through the app flow | Already proven on Postgres by the integration tests; this confirms it over the Neon driver |

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
- **One local branch, no commits yet.** When you say commit, the work is split into one branch and merge request per module (S0.1 to S0.9).
