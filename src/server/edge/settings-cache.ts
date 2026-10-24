import { slaSettingsFrom, type SlaSettings } from "@/modules/sla/service";
import type { Db } from "@/server/db/client";
import { readSettings } from "@/server/repositories/settings";

/**
 * `site_setting` read for the plain-function endpoints (leads, events). The settings that matter here change by an owner
 * action, rarely, and a request must not pay a database round trip just to learn the SLA hours, so each Worker isolate
 * keeps the values for a short time. A change reaches every isolate within `SETTINGS_TTL_MS`.
 */
export const SETTINGS_TTL_MS = 60_000;

interface Entry {
  at: number;
  values: Record<string, unknown>;
}

const entries = new Map<string, Entry>();

export async function cachedSettings(db: Db, key: string, now: number = Date.now()): Promise<Record<string, unknown>> {
  const hit = entries.get(key);
  if (hit && now - hit.at < SETTINGS_TTL_MS) return hit.values;
  const values = await readSettings(db);
  entries.set(key, { at: now, values });
  return values;
}

export async function cachedSlaSettings(db: Db, key: string, now?: number): Promise<SlaSettings> {
  return slaSettingsFrom(await cachedSettings(db, key, now));
}

/** `collect_page_views` is on unless the owner set it to false (the kill switch, ADR-003). */
export async function pageViewsEnabled(db: Db, key: string, now?: number): Promise<boolean> {
  return (await cachedSettings(db, key, now)).collect_page_views !== false;
}

/** For tests. */
export function resetSettingsCache(): void {
  entries.clear();
}
