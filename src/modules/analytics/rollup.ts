import { EVENT_TYPES } from "@/lib/constants";
import { PAGE_GROUPS } from "@/lib/page-group";
import { watDateString } from "@/lib/time";
import { parseDate } from "./funnel";

/**
 * The daily rollup (S7.1, architecture 8.5, 10.3). The collector counts anonymous events under keys
 * `agg:<WAT date>:<type>:<country>:<university>:<page group>` (`modules/events/service.ts` `countKey`); once a day this turns them
 * into rows of `event_daily_agg`, and the raw `wa_tap` rows that carry a lead reference are counted into the same table exactly
 * once and purged 30 days later (database function `app_rollup_raw_events`). Nothing here identifies a person: a key holds a date, an
 * event type, a country, a university and a coarse page name.
 *
 * Counts are handed out once and added to the table, so a failed write puts them back (the collector keeps them until a run
 * succeeds). The only way to lose a day is the Worker dying between the two steps, which an anonymous, approximate count accepts
 * (the funnel says so, B10 step 6).
 */

export interface AggRow {
  /** WAT date, `YYYY-MM-DD`. */
  date: string;
  type: string;
  country: string | null;
  universityId: string | null;
  pageGroup: string | null;
  count: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY = /^[A-Z]{2}$/;
const none = (part: string): string | null => (part === "-" || part === "" ? null : part);

/** One collector key and its count as a row, or null when the key is not one we wrote (it is then dropped, never stored). */
export function parseCountKey(key: string, count: number): AggRow | null {
  if (!Number.isFinite(count) || count <= 0 || !Number.isInteger(count)) return null;
  const parts = key.split(":");
  if (parts.length !== 6 || parts[0] !== "agg") return null;
  const [, date, type, country, universityId, pageGroup] = parts as [string, string, string, string, string, string];
  if (!DATE.test(date) || parseDate(date) === null) return null;
  if (!(EVENT_TYPES as readonly string[]).includes(type)) return null;
  const c = none(country);
  const u = none(universityId);
  const p = none(pageGroup);
  if (c !== null && !COUNTRY.test(c)) return null;
  if (u !== null && !UUID.test(u)) return null;
  if (p !== null && !(PAGE_GROUPS as readonly string[]).includes(p)) return null;
  return { date, type, country: c, universityId: u?.toLowerCase() ?? null, pageGroup: p, count };
}

export function rowsFromCounts(counts: Readonly<Record<string, number>>): { rows: AggRow[]; skipped: number } {
  const rows: AggRow[] = [];
  let skipped = 0;
  for (const [key, count] of Object.entries(counts)) {
    const row = parseCountKey(key, count);
    if (row) rows.push(row);
    else skipped += 1;
  }
  return { rows, skipped };
}

export interface RollupDeps {
  /** Takes every `agg:` count out of the collector (and resets its key counter). */
  drain: () => Promise<Record<string, number>>;
  /** Puts counts back after a failed write. */
  restore: (counts: Record<string, number>) => Promise<void>;
  /** Adds rows to `event_daily_agg`. */
  saveCounts: (rows: AggRow[]) => Promise<void>;
  /** Counts the raw tap rows of whole days before `todayWat` once, and purges the old ones. */
  rollRaw: (todayWat: string) => Promise<{ counted: number; purged: number }>;
  now: () => Date;
}

export interface RollupResult {
  keys: number;
  skipped: number;
  rows: number;
  rawCounted: number;
  rawPurged: number;
  failed: string[];
}

/**
 * Runs both halves of the rollup. A failure in one does not stop the other, and the result names what failed so the cron run can
 * report it (the caller throws when `failed` is not empty, which Cloudflare shows as a failed run).
 */
export async function runDailyRollup(deps: RollupDeps): Promise<RollupResult> {
  const result: RollupResult = { keys: 0, skipped: 0, rows: 0, rawCounted: 0, rawPurged: 0, failed: [] };

  let drained: Record<string, number> = {};
  try {
    drained = await deps.drain();
  } catch {
    result.failed.push("collector");
  }
  result.keys = Object.keys(drained).length;
  const { rows, skipped } = rowsFromCounts(drained);
  result.skipped = skipped;
  if (rows.length > 0) {
    try {
      await deps.saveCounts(rows);
      result.rows = rows.length;
    } catch {
      result.failed.push("counts");
      // The counts must not be lost: put them back so tomorrow's run adds them.
      try {
        await deps.restore(drained);
      } catch {
        result.failed.push("restore");
      }
    }
  }

  try {
    const raw = await deps.rollRaw(watDateString(deps.now()));
    result.rawCounted = raw.counted;
    result.rawPurged = raw.purged;
  } catch {
    result.failed.push("raw");
  }
  return result;
}
