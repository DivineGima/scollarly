#!/usr/bin/env node
/**
 * Publishes the seeded content (draft to published) until the admin content screens exist (Stage 6). Everything the seed
 * loaded is `draft` on purpose, so nothing becomes public by accident (S1.7). Running this is the owner's decision to show
 * the site's content to the public.
 *
 *   node scripts/publish-content.mjs --dry-run        counts what would be published, changes nothing
 *   node scripts/publish-content.mjs                  publishes
 *   node scripts/publish-content.mjs --only faq,university
 *
 * Environment: MIGRATION_DATABASE_URL (the owner's direct connection), as for `npm run db:migrate`.
 *
 * What it does NOT do, by design:
 *  - testimonials, journeys, team members and trust statistics (they need the owner's confirmation and consent records:
 *    the database refuses to publish them without, tracker H4);
 *  - blog posts (none are seeded);
 *  - anything already published or archived.
 * A fee that is not marked confirmed is published as a row, but the pages never show it: they say "Fees to be confirmed" (FR-2).
 *
 * After publishing, run the deploy workflow once: the build prerenders the pages from the database, so the new content shows
 * at once. Without it the pages refresh on their own within an hour.
 */
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set MIGRATION_DATABASE_URL (the owner's direct connection string).");
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyArg = args.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? (args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined);
const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;

// Parents first, so a published programme never points at an unpublished university.
const TABLES = ["university", "programme", "fee_structure", "campus_experience", "official_resource", "faq", "process_step", "content_block"];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  let total = 0;
  for (const table of TABLES) {
    if (only && !only.has(table)) continue;
    const result = dryRun
      ? await client.query(`select count(*)::int as n from public.${table} where status = 'draft'`)
      : await client.query(`update public.${table} set status = 'published', published_at = coalesce(published_at, now()), updated_at = now() where status = 'draft'`);
    const n = dryRun ? result.rows[0].n : result.rowCount;
    total += n;
    console.log(`${dryRun ? "would publish" : "published"} ${String(n).padStart(3)}  ${table}`);
  }
  await client.query(dryRun ? "rollback" : "commit");
  console.log(`${dryRun ? "Dry run: nothing changed." : "Done."} ${total} row(s).`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
