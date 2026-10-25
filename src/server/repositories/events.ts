import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";

/** The most `wa_tap` rows stored for one lead reference per WAT day (architecture 7.5, owner decision D7). */
export const WA_TAP_DAILY_CAP = 10;

/**
 * The most `wa_tap` rows stored per WAT day for references that match no lead (an offline-made lead not yet synced). It bounds the table
 * against a script that invents references; a real day has a handful (migration 0008).
 */
export const WA_TAP_UNLINKED_DAILY_CAP = 200;

export interface WaTap {
  leadRef: string;
  sessionId: string | null;
  universityId: string | null;
  pageGroup: string | null;
  /** Two letters from the edge request, never from the client. */
  country: string | null;
  occurredAt: string | null;
}

/**
 * Stores `wa_tap` events that carry a lead reference, over the daily cap per reference dropped without an error
 * (`app_record_wa_taps`, migrations 0005 and 0008). Returns how many rows were stored. Page views, form events and installs never come
 * here: they are counts in the collector.
 */
export async function recordWaTaps(db: Db, taps: readonly WaTap[]): Promise<number> {
  if (taps.length === 0) return 0;
  const payload = taps.map((t) => ({
    lead_ref: t.leadRef,
    session_id: t.sessionId,
    university_id: t.universityId,
    page_group: t.pageGroup,
    country: t.country,
    occurred_at: t.occurredAt,
  }));
  const [row] = rowsOf<{ stored: number }>(
    await db.execute(sql`select public.app_record_wa_taps(${JSON.stringify(payload)}::jsonb, ${WA_TAP_DAILY_CAP}::integer, ${WA_TAP_UNLINKED_DAILY_CAP}::integer) as stored`),
  );
  return Number(row?.stored ?? 0);
}
