import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * The first-visit tours a person has seen (architecture 21.10, FR-21): `app_user.tours_seen`, a list of tab keys. Reading is the caller's
 * own row. Writing goes through `app_mark_tour_seen` (migration 0013), which changes only the caller's own row and accepts only a short
 * lowercase tab key, so a person can never change their own role through it.
 */
export async function toursSeenOf(db: Db, actor: Actor): Promise<string[]> {
  const [result] = await runAs(db, actor, db.execute(sql`select tours_seen from app_user where id = ${actor.userId}`));
  return rowsOf<{ tours_seen: string[] | null }>(result)[0]?.tours_seen ?? [];
}

/** The caller's own staff row for the session payload, in one read: the tours seen, the away switch and the WhatsApp number (architecture 24.3). */
export async function ownStaffRowOf(db: Db, actor: Actor): Promise<{ toursSeen: string[]; away: boolean; whatsapp: string | null }> {
  const [result] = await runAs(db, actor, db.execute(sql`select tours_seen, away, whatsapp_number from app_user where id = ${actor.userId}`));
  const row = rowsOf<{ tours_seen: string[] | null; away: boolean | null; whatsapp_number: string | null }>(result)[0];
  return { toursSeen: row?.tours_seen ?? [], away: row?.away === true, whatsapp: row?.whatsapp_number ?? null };
}

export async function markTourSeen(db: Db, actor: Actor, tab: string): Promise<void> {
  await runAs(db, actor, db.execute(sql`select public.app_mark_tour_seen(${tab}::text)`));
}
