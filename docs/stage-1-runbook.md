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

The seed is built and tested with made-up data. **The real run needs the owner's old-site data (tracker H2)**: 9 universities with programmes, NAAC grades, fees (with `data_confirmed` and `last_updated_at`), campus tour assets, 12 FAQs, the 6-step process and 5-step visa copy, the "Why Scollarly" and mission copy, the university logos and campus images, and any `ContactSubmission` rows. Claude Code does not invent any of it.

Put the data in `data/seed/` in the shape `src/modules/seed/schema.ts` defines:

```
data/seed/universities.json     an array; each university has programmes, fees, campus_experiences, resources
data/seed/faqs.json
data/seed/process-steps.json
data/seed/content-blocks.json
data/seed/logos/*.png|jpg|webp  and photos/ ... any image a file names
```

- Everything defaults to `"status": "draft"`. A row is public only if its file says `"published"`.
- A fee with `"data_confirmed": true` needs `amount_min` above 0 and `amount_max` at least `amount_min`; an unconfirmed fee may have no amounts (the site then shows the WhatsApp call to action, FR-2).
- Images may be PNG, JPEG or WebP (SVG is refused). The script converts them to WebP within the caps (50 KB logos, 300 KB photos).

```
npm run seed -- --dir data/seed --dry-run     # validate everything and convert every image, write nothing
MIGRATION_DATABASE_URL=...  NEON_STORAGE_ENDPOINT=... NEON_STORAGE_REGION=...
NEON_STORAGE_ACCESS_KEY_ID=...  NEON_STORAGE_SECRET_ACCESS_KEY=...   npm run seed -- --dir data/seed
```

`MIGRATION_DATABASE_URL` is the owner role's connection string (the one the migrations use). Run it a second time: it must report zero rows and every image `existing`. The seed is insert-only, so it never overwrites an edit made later in the admin screens.

**Not built yet:** migrating `ContactSubmission` rows into `lead`. It needs the old export first, and one owner decision: a migrated lead has no reply logged, so it would show as overdue forever unless the owner says how old leads are treated.
