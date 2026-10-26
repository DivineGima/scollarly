import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import type { AggRow } from "@/modules/analytics/rollup";

/**
 * The two database calls behind the daily rollup (S7.1, migration 0009). The cron job has no signed-in person, so both are
 * SECURITY DEFINER functions the runtime role may call (like `app_create_lead`): they only ever add counts to `event_daily_agg`,
 * count the raw tap rows once, and purge the ones counted more than 30 days ago.
 */

export async function saveAggregateRows(db: Db, rows: readonly AggRow[]): Promise<void> {
  const json = JSON.stringify(rows.map((r) => ({ date: r.date, type: r.type, country: r.country, university_id: r.universityId, page_group: r.pageGroup, count: r.count })));
  await db.execute(sql`select public.app_rollup_counts(${json}::jsonb)`);
}

export async function rollRawEvents(db: Db, todayWat: string): Promise<{ counted: number; purged: number }> {
  const result = await db.execute(sql`select * from public.app_rollup_raw_events(${todayWat}::date)`);
  const row = rowsOf<{ out_counted: number; out_purged: number }>(result)[0];
  return { counted: row?.out_counted ?? 0, purged: row?.out_purged ?? 0 };
}
