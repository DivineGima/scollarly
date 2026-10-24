# Runbook: Stages 3 and 4 (public site, offline, lead intake)

Built against `essentials/system_architecture_essential_1.md`, `system_architecture/system_architecture_1.md`, `prd/PRD_1.md` (all version 1). Built together on one branch at the owner's request (2026-10-25); each module's tests are separate. This file lists what you, the owner, must do, in order, and what each page does.

## 1. What was built

| Area | Where | What it does |
|---|---|---|
| Content read layer (S3.1) | `src/server/repositories/content.ts`, `src/modules/content/` | Public pages read published content once, at build or revalidate time, and Next.js keeps it under a tag. A page request that hits the cache never touches Neon. Row level security and the queries both allow published rows only. |
| Pages (S3.2) | `src/app/[locale]/(public)/` | Home, universities, university detail, fees, campus tours, process, visa, FAQ, about, blog and post, contact, privacy, terms, offline, apply. All text through message keys (`messages/en.json`, `fr.json`). |
| Fees, video, tours (S3.3) | `modules/content/fees.ts`, `embed.ts`, `components/public/campus-embed.tsx` | A fee shows only when confirmed with a real range; otherwise "Fees to be confirmed" and a WhatsApp button. Videos and tours load only after a tap, from `youtube-nocookie.com`. |
| Trust components (S3.4) | `components/public/trust.tsx` | Figures, testimonials, journeys and team render only when confirmed, verified and consented. They render nothing when empty. |
| Performance (S3.5) | `scripts/check-public-bundle.mjs`, `lighthouserc.json` | CI checks first-load JavaScript per public route and that no admin library reaches a public route; Lighthouse runs on every public route. |
| Service worker, manifest, install (S4.1) | `src/app/sw.ts`, `src/app/manifest.ts`, `public/icons/` | Never caches admin, student, auth or API; caches build files, images and visited pages; installable after a repeat visit. |
| Offline queue and sync (S4.2) | `src/offline/` | IndexedDB queue, retries after 5 s, 30 s, 2 min, 10 min, then hourly, Web Locks, 30-day flag, delete on success, "Remove from this phone". |
| Forms (S4.3) | `components/public/lead/` | Quick WhatsApp form on every "Chat on WhatsApp" button, and the full form at `/apply`. Send first, wait up to 4 seconds, then open WhatsApp. |
| Lead endpoint (S4.4) | `src/modules/leads/service.ts`, `src/server/edge/leads.ts`, migration `0005` | Idempotency, payload hash, Turnstile, rate limiter, 5 leads per number per 24 hours, phone normalisation, server-time SLA, reference collision handling. |
| Events (S4.5) | `src/modules/events/`, `src/server/edge/events.ts`, `worker/collector.ts` | Batches of up to 50. Page views, form events and installs are counts only. A `wa_tap` with a lead reference is a row, at most 10 per reference per day. |
| Contact and WhatsApp (S4.6) | `contact` page, `lib/whatsapp.ts` | Every number comes from `site_setting`. A test fails if a number or a `wa.me` link is written anywhere else. |

## 2. What you must do (human actions), in this order

1. **Merge the pull request** on GitHub (Claude Code cannot merge: the permission check stops it).
2. **Publish the content.** Everything the seed loaded is `draft`, so the public pages show their "being added" messages until you publish.
   - Preview: `node scripts/publish-content.mjs --dry-run` (with `MIGRATION_DATABASE_URL` set, as for the migration).
   - Publish: `node scripts/publish-content.mjs`. It publishes universities, programmes, fees, campus experiences, resources, FAQs, process steps and copy blocks. It never publishes testimonials, team, journeys or figures (see step 5).
   - Or tell Claude Code to run it for you.
3. **Run the deploy workflow** (Actions, "Stage 0 deploy and measure", Run workflow, on `main`). It applies migration `0005`, builds the site from the database (so the published content is prerendered), deploys, and measures the lead endpoint (it now posts a real quick lead and removes the test leads afterwards).
4. **Turnstile (real widget).** Until you do this the Worker uses Cloudflare's always-pass test keys, which anyone can pass. Create a Turnstile widget for `scollarly.gimafolabit.workers.dev` (Cloudflare dashboard, Turnstile, Add widget). Then add two repository secrets: `TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY`. Run the deploy workflow again. Claude Code can do this with the Cloudflare and GitHub tools if you say so.
5. **Trust content (tracker H4).** Give Claude Code, or later the admin screens (Stage 6), the confirmed figures, the testimonials with consent records and the team bios. Nothing unconfirmed is published, and the database refuses it.
6. **Privacy notice and terms (tracker H5).** The pages show a short summary and say the full text is being finalised. When the legal text exists, it goes in the content blocks `privacy.body` and `terms.body`, and `CONSENT_NOTICE_VERSION` in `src/lib/lead-form.ts` changes so each lead records which text the student agreed to.
7. **JavaScript budget (tracker H9).** The architecture says 100 KB gzip for public JavaScript. Next.js and React alone are about 102 KB, so no page can meet it. The check script uses a ceiling of the measured framework size plus an allowance for our own code (`PUBLIC_JS_CEILING_KB`, now 118). Decide whether to accept this.
8. **Object Storage limits (tracker H12).** Still open: read Neon's plans page for Object Storage request and transfer limits. Pages show text placeholders where there is no image; upload of images arrives with Stage 6.
9. **Check on a phone**, on mobile data: open the site, tap "Chat on WhatsApp" on a university, fill the form, and confirm the chat opens with your reference and that the lead is in the database. Turn on airplane mode and repeat; turn it off and watch the lead arrive.

## 3. Rules you may want to know

- A lead is saved on the phone first, then sent. If the server answers in under 4 seconds WhatsApp opens after it; if not, WhatsApp opens anyway and the lead is sent later with the same key, so one lead is stored.
- A WhatsApp number can create 5 leads in 24 hours. The sixth is refused and the student is offered the chat instead.
- The offline full form works once `/apply` has been opened online once (the page and its code are then kept on the phone). The quick form works offline on any page visited before.
- Events: a few page views travel together (5 events or 5 minutes), and a WhatsApp tap with a reference is sent at once.

## 4. Measurements to record after the deploy (CPU gates, at most 8 ms warm p95)

| Request | Where measured |
|---|---|
| `POST /api/v1/leads` (real quick lead) | the deploy workflow's CPU step |
| `POST /api/v1/events` | not yet in the workflow; add a scenario in `scripts/measure-cpu.mjs` if you want a number |
| Public page cache hit and image hit | the deploy workflow's CPU step (unchanged) |
