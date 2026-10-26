# Stages 6 to 8: content and images, analytics, student portal

Built together on branch `feat/stages-6-8` (one merge request, CI once, per the Session 27 slim process).

## What exists

| Stage | Screens | Data calls (`GET /api/v1/...`) | Operations (`POST /api/v1/...`) |
|---|---|---|---|
| 6 | `/admin/content`, `/admin/content/<type>`, `/admin/content/<type>/<id or new>`, `/admin/content/media`, `/admin/content/stale` | `admin/content-hub`, `content-list`, `content-item`, `media`, `media-item`, `stale` | `admin/content.save`, `.publish`, `.unpublish`, `.archive`, `.restore`, `.markChecked`, `consent.create`, `consent.revoke`, `media.upload` (the body is the image), `media.setAlt`, `media.archive`, and `admin/revalidate` (through Next.js) |
| 7 | `/admin/analytics` (Funnel, Sources, My performance) | `admin/analytics`, `admin/performance` | none; the daily cron job does the rollup |
| 8 | `/me`, `/me/link-application`, `/me/profile`, `/me/data` | `me/progress`, `me/profile` | `me/profile.setName`, `me/student.requestLink`, `me/student.exportData`, `me/student.requestErasure` |

One definition per content type (`src/modules/content-admin/definitions.ts`) drives the Zod schema, the form, the list, the publish gates and what the public site must refresh. To add a content type: add its definition, its label in `LABEL` (`src/server/repositories/content-admin.ts`), its words in `messages/*.json` (`admin.content.types.<key>`), and the table's columns must match (a test compares the definition with the real columns).

## Migration 0009 (additive)

`event.rolled_up_at`; the `auto` claim no longer needs a verification method (a CHECK is loosened); a trigger that refuses to publish a testimonial or journey against a withdrawn consent; six SECURITY DEFINER functions: `app_rollup_counts`, `app_rollup_raw_events`, `app_link_new_lead`, `app_request_link`, `app_log_my_export`, `app_erase_my_account`.

## Decisions made without asking (veto any of them)

- Editing a **published** item saves straight to the live row, and is checked by the publish gates again.
- A journey's **saved steps cannot be removed** (no physical deletes, ADR-029). New steps can be added and unsaved ones removed.
- Charts are plain CSS bars, **no Recharts**, so no new dependency and no bundle growth.
- A publish is a plain function and cannot call `revalidateTag`; the screen makes one extra request to `POST /api/v1/admin/revalidate` (a Next.js route). If it never arrives the site still catches up (edge copy 30 s, pages hourly).
- A document photo is **pixelated** in the browser (irreversible), not lightly blurred. The server cannot see the pixelation; it records the confirmation in the audit entry.
- The offline copy of `/me` is shown by `/me` itself when the data call cannot be reached, and by the saved `/offline` page. `/me` is never cached.
- Self-service erasure is for **student** accounts only; a team account is told to ask the owner.
- Funnel stage counts are "leads that reached this stage or a later one"; merged duplicates are left out; erased leads stay (counts remain, architecture 7.9).

## Things only the owner can confirm (not done by Claude Code)

1. **Erasure deletes Neon Auth rows** (`neon_auth.session`, `account`, `user`). Neon manages that schema. Try `app_erase_my_account` on a **throwaway Neon branch** with a throwaway Google account before relying on it (same caution as flag F13). If Neon's tables cannot be deleted from, the whole erasure rolls back and the student sees "Something went wrong"; nothing is half done.
2. **Re-sign-in for erasure**: confirm that "Sign in again" at `/auth/start` makes a fresh Neon Auth session (the 10 minute check reads the session's creation time).
3. **The first revalidate call after a deploy** may be refused for CPU (Stage 0 saw this). The screen retries once; watch Workers Logs for `admin/revalidate` errors.
4. **CPU rows**: run the deploy workflow once with `cpu_scenarios` = `content-list,analytics,student-progress`. The content/media writes and revalidate share the shape of already measured writes and are watched in production logs.
5. Image budget banner at 70% and the 3.5 GB budget (F16) are as before.
6. Worker size: CI's `npm run size` must still be under 2.6 MiB compressed (not measured locally; OpenNext's build is unreliable on Windows).
7. French text is unreviewed by a native speaker (`fr` is not an active locale).

## Checks run locally

Typecheck, lint, unit, integration (PGlite) and `next build` with the public bundle check; the Playwright spec `tests/e2e/stage6-8.spec.ts` with mocked endpoints. The live proof that a published fee reaches the public page with no deploy (FR-16) needs the deployed Worker.
