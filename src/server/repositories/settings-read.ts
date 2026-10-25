import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runPublic } from "./as-actor";

/**
 * Reads every `site_setting` row as a public visitor (the policy `site_setting_read` allows it). It is a plain SQL read in its
 * own file, so the lead and event endpoints can use it without loading the schema file (see `lead-intake.ts` for why that
 * matters on a fresh Worker instance). `repositories/settings.ts` re-exports it.
 */
export async function readSettings(db: Db): Promise<Record<string, unknown>> {
  const [result] = await runPublic(db, db.execute(sql`select key, value from public.site_setting`));
  return Object.fromEntries(rowsOf<{ key: string; value: unknown }>(result).map((row) => [row.key, row.value]));
}
