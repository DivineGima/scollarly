import { watDateString } from "@/lib/time";
import type { WaTap } from "@/server/repositories/events";
import type { EventItem } from "./schema";

/**
 * What happens to a batch of events (architecture 10.2, 10.3, owner decision D7):
 *
 *  - a `wa_tap` that carries a lead reference is a row in Neon (at most 5 per batch, at most 10 per reference per WAT day, and at
 *    most 200 a day for references that match no lead, the last two enforced by the database function, so a flood cannot grow the table);
 *  - everything else (`page_view`, `form_start`, `form_submit`, `install`, and a `wa_tap` with no reference) is only a count in
 *    the collector, keyed by WAT date, type, country, university and page group. No row, no identifier.
 *
 * This file decides; `server/edge/events.ts` does the I/O.
 */

export interface EventPlan {
  /** Rows for Neon. */
  taps: WaTap[];
  /** Counter key to increment by, for the collector. */
  counts: Record<string, number>;
  /** Events dropped by the kill switch (`collect_page_views = false`). */
  dropped: number;
}

/** The collector's counter key. `-` stands for "none" so the key always has six parts. */
export function countKey(parts: { date: string; type: string; country: string | null; universityId: string | null; pageGroup: string | null }): string {
  return ["agg", parts.date, parts.type, parts.country ?? "-", parts.universityId ?? "-", parts.pageGroup ?? "-"].join(":");
}

/** A browser flushes a tap or two at a time; a batch with more is a script, and the extra taps are not stored. */
export const MAX_TAPS_PER_BATCH = 5;

export function planEvents(events: readonly EventItem[], options: { country: string | null; now: Date; collectPageViews: boolean }): EventPlan {
  const plan: EventPlan = { taps: [], counts: {}, dropped: 0 };
  const date = watDateString(options.now);
  const country = options.country && /^[A-Z]{2}$/.test(options.country) ? options.country : null;

  for (const event of events) {
    if (event.type === "wa_tap" && event.lead_ref) {
      if (plan.taps.length >= MAX_TAPS_PER_BATCH) {
        plan.dropped += 1;
        continue;
      }
      plan.taps.push({
        leadRef: event.lead_ref,
        sessionId: event.session_id ?? null,
        universityId: event.university_id ?? null,
        pageGroup: event.page_group ?? null,
        country,
        occurredAt: event.occurred_at ?? null,
      });
      continue;
    }
    if (event.type === "page_view" && !options.collectPageViews) {
      plan.dropped += 1;
      continue;
    }
    const key = countKey({ date, type: event.type, country, universityId: event.university_id ?? null, pageGroup: event.page_group ?? null });
    plan.counts[key] = (plan.counts[key] ?? 0) + 1;
  }
  return plan;
}
