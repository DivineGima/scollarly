# Stage 1 runbook: foundation

Built against `essentials/system_architecture_essential_1.md`, `system_architecture_1.md` and `PRD_1.md` (all version 1). Module status is in `tracker/tracker_1.md`.

## What Stage 1 added

| Module | Where |
|---|---|
| S1.1 Schema, constraints, row level security, seeds | `src/server/db/schema.ts`, migration `0003_stage1_foundation.sql` (tables, CHECKs, indexes, then policies and the seed rows) |
| S1.2 Repositories and the `Actor` | `src/server/repositories/` (`as-actor.ts`, `settings.ts`, `pipeline.ts`, `leads.ts`, `media.ts`, `seed.ts`), `src/server/auth/permissions.ts` |
| S1.3 Shared libraries | `src/lib/` (`time`, `result`, `uuid`, `phone`, `ref`, `whatsapp`, `http`, `constants`, `translations`, `schemas/`) |
| S1.4 SLA | `src/modules/sla/service.ts` |
| S1.5 CI | `.github/workflows/ci.yml`, `tests/integration/authz-matrix.test.ts`, `src/lib/security-headers.ts`, `tests/e2e/foundation.spec.ts` |
| S1.6 i18n and design tokens | `src/i18n/` (`rewrites`, `messages`), `messages/fr.json`, `src/app/globals.css` |
| S1.7 Seed and image import | `src/modules/seed/`, `src/server/media/ingest.ts`, `scripts/seed.ts`, `scripts/lib/image.ts` |

## Running the checks locally

```
npm run lint
npm run typecheck
npm test                    # unit tests
npm run test:integration    # PGlite locally; set TEST_DATABASE_URL to use a real Postgres, as CI does
npm run test:e2e            # production build, Playwright (offline mode, axe, headers)
```

## Changing the schema

1. Edit `src/server/db/schema.ts`. A new table needs its row level security in the same migration (`ENABLE` and `FORCE ROW LEVEL SECURITY`, at least one policy, and a row in `READS` in `tests/integration/rls-policies.test.ts`).
2. `npx drizzle-kit generate --name <what>` (set `MIGRATION_DATABASE_URL` to any value; generating does not connect).
3. Append the policies and grants to the generated file, as `0003` does. Migrations are additive-first (architecture 14).
4. CI fails if the schema and the migrations disagree ("Migrations match the schema").

## Seeding the old site's content (S1.7)

The old site's data (tracker H2) was supplied on 2026-10-24 and is converted into `data/seed/`, in the shape `src/modules/seed/schema.ts` defines. Nothing was invented: every value comes from the old `universities.ts` and `page.tsx`. The old site's text was copied as it was, except two spelling fixes in the hero subtitle ("universites" and "thier").

```
data/seed/universities.json     9 universities: 77 programmes, 9 confirmed fees, 5 campus tours
data/seed/faqs.json             12
data/seed/process-steps.json    6 application steps, 5 visa steps
data/seed/content-blocks.json   36 copy blocks (mission, values, Why Scollarly, services, visa note, fee disclaimer, contact)
data/seed/site-settings.json    the WhatsApp number and the contact number shown (owner, H3)
data/seed/logos/                the 9 logos, downloaded from the old site's own URLs
data/seed/site-images/          4 page photos, kept for Stage 3 (hero, about, campus, network); the seed does not import them
data/seed/brand/logo.svg        the Scollarly mark, kept for Stage 3
```

How the old data maps: a duration of "4 years" is 48 months; tuition, hostel and total are three `fee_structure` rows (period "tuition per year", "hostel per year", "total course"); a university's overview text is its `translations.en` (F17); `type` is set only where the old overview states it. A university with no confirmed fee has no fee rows. Aditya's logo was an SVG, which the importer refuses, so it was rasterised once to `logos/aditya-university.png`.

**Everything is `draft`.** To publish a row, add `"status": "published"` to it before the real run, or do it in the admin screens (Stage 6).

**Review before publishing** (claims copied from the old site that the owner has not confirmed): "900+ industry partnerships", "30,000+ students" and "top 25" (Chandigarh University); "over 25 countries" (CGC); "we've been through it dozens of times" (visa service); "€200–€1,000" (Why Scollarly); the FAQ that points to "the #team section above"; "9+ partner universities". The old copy also disagrees with itself on timing: the FAQ says visa processing takes 6 to 12 weeks, the visa step says 3 to 5 working days.

**Not seeded:** testimonials, team bios and the "100+ students / 5+ countries" counters (CLAUDE.md: no unconfirmed statistics, testimonials or team bios); each university's scholarship text ("Up to 50% via Scollarly"; no column for it); the two 360° tours and the YouTube tours are seeded, but CSP `frame-src` allows only YouTube and Turnstile, so S11.1 must decide whether a 360° tour opens in a new tab.

- Everything defaults to `"status": "draft"`. A row is public only if its file says `"published"`.
- A fee with `"data_confirmed": true` needs `amount_min` above 0 and `amount_max` at least `amount_min`; an unconfirmed fee may have no amounts (the site then shows the WhatsApp call to action, FR-2).
- Images may be PNG, JPEG or WebP (SVG is refused). The script converts them to WebP within the caps (50 KB logos, 300 KB photos).

```
npm run seed -- --dir data/seed --dry-run     # validate everything and convert every image, write nothing
MIGRATION_DATABASE_URL=...  NEON_STORAGE_ENDPOINT=... NEON_STORAGE_REGION=...
NEON_STORAGE_ACCESS_KEY_ID=...  NEON_STORAGE_SECRET_ACCESS_KEY=...   npm run seed -- --dir data/seed
```

`MIGRATION_DATABASE_URL` is the owner role's connection string (the one the migrations use). Run the real seed only after the migration `0003` is on that database (it is applied when pull request #15 is merged and deployed). Run it a second time: it must report zero rows and every image `existing`. The seed is insert-only, so it never overwrites an edit made later in the admin screens; the two contact settings are filled only while they are still unset.

**Not built yet:** migrating `ContactSubmission` rows into `lead`. The owner decided on 2026-10-24 that old leads are exempt from the SLA, but no rows were supplied (only the model and the form route). The old form never required a phone, and a `lead` needs a valid WhatsApp number, so a row without a phone cannot become a lead. Export the table (id, name, email, phone, message, country, status, createdAt) as JSON to build the import, or confirm it is empty.
