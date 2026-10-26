/**
 * Builds the database the backup self-test dumps (S10.3 exit criteria): a throwaway Postgres with the stand-in for Neon's own schema, every
 * committed migration applied (so the dump carries the real tables, row level security, policies, triggers and functions), the
 * `app_runtime` role, and a few rows with a marker that must survive the round trip.
 *
 *   SELFTEST_DATABASE_URL=postgres://... npx tsx scripts/ops/selftest-db.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { NEON_AUTH_STUB } from "../../tests/integration/helpers/db";

const url = process.env.SELFTEST_DATABASE_URL;
if (!url) throw new Error("SELFTEST_DATABASE_URL is not set");

async function main(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
    );
    await client.query(NEON_AUTH_STUB);
    await migrate(drizzle(client), {
      migrationsFolder: "./src/server/db/migrations",
    });

    const university = (
      await client.query(
        `insert into university (id, slug, name) values (gen_random_uuid(), 'selftest-university', 'Selftest University') returning id`,
      )
    ).rows[0].id as string;
    await client.query(
      `insert into lead (id, ref, client_ref, idempotency_key, payload_hash, name, whatsapp_e164, country_code, intake_kind, qualification_type, consent_notice_version, consent_at, sla_due_at, sla_hours_applied)
     values (gen_random_uuid(), 'SC-K7M2Q-XB9T4', 'SC-K7M2Q-XB9T4', gen_random_uuid(), repeat('a', 64), 'Backup Marker Person', '+237651232301', 'CM', 'full', 'olevel_alevel', 'v1', now(), now(), 4)`,
    );
    await client.query(
      `insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by) values (gen_random_uuid(), gen_random_uuid(), $1, 123456, '2026-10-01', 'selftest')`,
      [university],
    );
    await client.query(
      `insert into media_asset (id, kind, width, height, bytes, mime, sha256) values (gen_random_uuid(), 'photo', 10, 10, 1000, 'image/webp', repeat('b', 64))`,
    );
    const counts = (
      await client.query(
        `select (select count(*) from lead)::int as leads, (select count(*) from placement_payment)::int as payments, (select count(*) from media_asset)::int as media`,
      )
    ).rows[0];
    console.log(`Seeded: ${JSON.stringify(counts)}`);
  } finally {
    await client.end();
  }
}

main(url).catch((error) => {
  console.error(error);
  process.exit(1);
});
