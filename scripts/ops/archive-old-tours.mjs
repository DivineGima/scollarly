#!/usr/bin/env node
/**
 * S14.6: archives the earlier placeholder tour videos ("Official Campus Tour") of a university once its verified replacement
 * ("Official campus tour video") is published. Nothing is deleted (CLAUDE.md: archive, never delete). Safe to run twice.
 *
 * Environment: MIGRATION_DATABASE_URL (owner, direct).
 */
import pg from "pg";

const { MIGRATION_DATABASE_URL } = process.env;
if (!MIGRATION_DATABASE_URL) {
  console.error("MIGRATION_DATABASE_URL is required.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: MIGRATION_DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query(`
    update public.campus_experience old
       set status = 'archived', updated_at = now()
     where old.kind = 'video' and old.title = 'Official Campus Tour' and old.status <> 'archived'
       and exists (select 1 from public.campus_experience nw
                    where nw.university_id = old.university_id and nw.kind = 'video'
                      and nw.title = 'Official campus tour video' and nw.status = 'published')
    returning old.id, old.youtube_id`);
  console.log(`archived ${rows.length} earlier tour video row(s)`);
  for (const r of rows) console.log(`  ${r.id} (${r.youtube_id})`);
} finally {
  await client.end();
}
