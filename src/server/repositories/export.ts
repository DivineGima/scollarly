import { sql } from "drizzle-orm";
import { assembleExport, EXPORT_TABLES } from "@/modules/export/tables";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";
import { auditEntry } from "./audit";

/**
 * The owner's full export (S10.3). Every table in `EXPORT_TABLES` is turned into one JSON text by Postgres itself and read in one round
 * trip, inside one transaction, so the file is a consistent picture; the Worker only joins the texts. The audit row is written in the
 * same transaction: an export that is not recorded did not happen. Row level security applies as the owner; the facade and the 2FA
 * step-up are checked by the endpoint first.
 */
export async function exportEverything(db: Db, actor: Actor, now: Date): Promise<string> {
  const queries = EXPORT_TABLES.map((table) => db.execute(sql`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text as json from ${sql.identifier("public")}.${sql.identifier(table)} t`));
  const audit = auditEntry(db, actor, { action: "owner.export", entityType: "export", meta: { tables: EXPORT_TABLES.length } });
  const results = await runAs(db, actor, ...(queries as [(typeof queries)[number], ...(typeof queries)[number][]]), audit);
  const parts: Record<string, string> = {};
  EXPORT_TABLES.forEach((table, index) => {
    parts[table] = rowsOf<{ json: string }>(results[index])[0]?.json ?? "[]";
  });
  return assembleExport(now.toISOString(), parts);
}
