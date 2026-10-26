import { eq, sql } from "drizzle-orm";
import type { SettingKey } from "@/lib/constants";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { siteSetting } from "@/server/db/schema";
import { runAs } from "./as-actor";

/**
 * `site_setting` (architecture 7.3). Anyone may read: pages need the WhatsApp number and the SLA hours. Only the owner
 * may change a value (policy `site_setting_update`); the facade's `requireOwner(..., { stepUp: true })` is the first lock.
 */

/** Every setting as `key -> value`. A JSON `null` means the owner has not set it yet. */
// Reading the settings lives in its own file (see settings-read.ts); re-exported so imports keep working.
export { readSettings } from "./settings-read";

/**
 * Sets one setting. Returns false when no row changed, which is what the policy does to anyone but the owner: row level
 * security hides the row instead of raising an error, so a caller must check the result.
 */
export async function updateSetting(db: Db, actor: Actor, key: SettingKey, value: unknown): Promise<boolean> {
  // The value is always sent as JSON text with an explicit cast: a JavaScript null would be SQL NULL, which the column refuses,
  // while "not set" is the JSON value `null` (see the seeds in migration 0003).
  const json = sql`${JSON.stringify(value ?? null)}::jsonb`;
  const [rows] = await runAs(db, actor, db.update(siteSetting).set({ value: json }).where(eq(siteSetting.key, key)).returning({ key: siteSetting.key }));
  return rows.length === 1;
}

/**
 * S10.1 (architecture 16 C4 step 2): several settings in ONE statement, each with its audit row for the whole change, so both commit or
 * neither does. A setting whose value is already what was asked for is left alone and not reported, so saving an untouched form writes
 * nothing. The audit row names the keys only: a phone number is not needed there and the log is not the place for values.
 * If any key has no row nothing at all is written (the caller gets it back in `missing`), so a refused request never half-applies.
 * Returns the keys that really changed, and any key with no row. Row level security (policy `site_setting_update`) lets the owner through and nobody else, so a
 * caller that is not the owner gets nothing changed, not an error: check the facade first, as the endpoint does.
 */
export async function updateSettings(db: Db, actor: Actor, changes: Readonly<Record<string, unknown>>): Promise<{ changed: string[]; missing: string[] }> {
  const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return { changed: [], missing: [] };
  const values = sql.join(
    entries.map(([key, value]) => sql`(${key}::text, ${JSON.stringify(value ?? null)}::jsonb)`),
    sql`, `,
  );
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with v(key, value) as (values ${values}),
      upd as (
        update site_setting s set value = v.value from v
         where s.key = v.key and s.value is distinct from v.value
           and not exists (select 1 from v v2 where not exists (select 1 from site_setting k where k.key = v2.key))
        returning s.key
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'settings.update', 'site_setting', null,
               jsonb_build_object('keys', (select jsonb_agg(key order by key) from upd))
         where exists (select 1 from upd)
      )
      select v.key, (s.key is not null) as present, (upd.key is not null) as changed
        from v left join site_setting s on s.key = v.key left join upd on upd.key = v.key
       order by v.key`),
  );
  const rows = rowsOf<{ key: string; present: boolean; changed: boolean }>(result);
  return { changed: rows.filter((row) => row.changed).map((row) => row.key), missing: rows.filter((row) => !row.present).map((row) => row.key) };
}
