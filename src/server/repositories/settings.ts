import { eq, sql } from "drizzle-orm";
import type { SettingKey } from "@/lib/constants";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
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
