# Free-quota review (S11.4)

Prepared 2026-10-26 from the tracker, the architecture (section 3 estimates, section 12) and the vendors' own pages. **Measured** means a number from a deployed run or CI. **Estimated** means arithmetic from the architecture. **Not measured** is said plainly. No paid service is assumed anywhere.

| Resource | Free limit | Where we are | Headroom | Source / how to re-check |
|---|---|---|---|---|
| Worker size (compressed) | 3 MiB, our gate 2.6 MiB | Measured 1.344 MiB at Stage 1 (CI). Stages 2 to 11 added code; the CI job "Build and Worker size gate" prints and enforces it on every merge request. **This stage's figure is whatever that job shows for this pull request.** | Gate fails the build above 2.6 MiB | `npm run size` in CI |
| Worker CPU per request | 10 ms | Measured warm p95 2 to 6 ms for the public page, images, staff and student shells and data calls, events, merge, erase, content list, analytics, student progress. Over the 8 ms gate and accepted by the owner: lead POST (F19), lead detail (F20). Staff reads varied 9 to 12 ms once and passed on re-runs (Session 28). **Payments list: row added to the measurement (`payments`), run with the next deploy.** Settings, Health, export: owner only, **not measured** (no owner session in the measurement; they are watched in Workers Logs). | 0 requests terminated in any run | tracker Sessions 19 to 31; Workers Logs |
| Worker requests | 100,000 a day | Estimated in architecture section 3 at a few thousand a day at launch scale (students on cached pages mostly never reach the Worker: the edge copy answers) | Large | Cloudflare dashboard, Workers, Metrics |
| Cron triggers | Available on free | One daily job (rollup, then usage check). Measured: ran from 2026-10-23; Health now shows the last run of each | n/a | Health page |
| Durable Objects | Free tier (SQLite-backed) | Counter and rate limiter work; low volume | Large | Cloudflare dashboard |
| KV / D1 (OpenNext caches) | Free tiers, no card | Created by the deploy workflow with no payment prompt (Session 6) | Large | Cloudflare dashboard |
| Neon database storage | The plans page has said 0.5 GB and 1 GB; **we check against 0.5 GiB** | Health page shows the live size and warns from 70% (350 MiB), urgent from 90%. The daily job logs the same | Raw events are purged 30 days after rollup; `audit_log` and `lead_activity` are the tables that only grow | Health page, Neon console |
| Neon compute hours | 100 CU-hours a month | **Not measured.** No keep-warm pings; the Worker reads Neon only for signed-in screens, form submits and the daily job. The Stage 0 probe for a reporting API was never measured, so none is assumed. | Unknown until a month of production traffic | Neon console, Billing / Usage. Health links to it. Check it in the first week and monthly (H10) |
| Neon Object Storage | 5 GB per project | Image budget 3.5 GiB by setting (owner can change, 100 MiB to 5 GiB). Health shows use against the budget, warns from 70%. Request and transfer limits: the pricing page shows none (H12) | 1.5 GiB between budget and the free limit | Health page |
| Neon Auth | 60,000 monthly users | A few staff and students | Large | Neon console |
| Turnstile | Free, unlimited on the managed widget | Lead forms only | Large | Cloudflare dashboard |
| GitHub Actions minutes | 2,000 a month on a private repository | The repository is **public** since 2026-10-25 so minutes are free (H20 asks to make it private again; then this limit applies). CI runs once per merge request; the deploy measurement is about 25 minutes a run; the uptime check is about 30 seconds an hour (about 360 minutes a month if the repository is private) | Tight if private: CI + deploys + 360 uptime minutes. Consider an uptime check every 3 hours if H20 is done | GitHub, Settings, Billing |
| GitHub artifact storage | **500 MB** on GitHub Free (GitHub Docs, "About billing for GitHub Actions", read 2026-10-26; shared with Packages) | One encrypted dump a week, kept 28 days: 4 files. A dump of a small database is a few MB. The backup workflow reads the real usage after each upload and **fails the run at 70%** so GitHub tells the owner | Large at this size; the check is the safety net | Backup workflow summary |
| Resend / email | Removed (ADR-036) | n/a | n/a | n/a |

## What to do about the two unknowns

1. **Neon compute hours** is the one limit nobody can read from the app. Put a reminder to look at the Neon console's usage page after the first week of real traffic and again each month. If it passes 70%, the options are the page-view switch (Health, "Pause page-view collection"), fewer admin refreshes, or Neon's paid plan (owner decision; CLAUDE.md forbids adding a paid service without it).
2. **Private repository minutes** (H20). If the repository goes private, run the uptime workflow less often (edit its cron) and watch the Actions usage page.
