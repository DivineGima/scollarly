import { DurableObject } from "cloudflare:workers";

/**
 * S0.7: Durable Object counter. In Stage 7 this becomes the collector for anonymous event counts
 * (ADR-003, counts only, never rows). In Stage 0 it proves a counter works on the free plan and records
 * the last cron run so the scheduled handler is observable.
 */
/** The most distinct `agg:` keys held between two rollups. A real day is a few hundred (types x countries x universities x page groups). */
export const AGG_KEY_CAP = 10_000;
const AGG_KEY_COUNT = "agg_key_count";

export class Collector extends DurableObject<CloudflareEnv> {
  async increment(type: string, by = 1): Promise<number> {
    const key = `count:${type}`;
    const next = ((await this.ctx.storage.get<number>(key)) ?? 0) + by;
    await this.ctx.storage.put(key, next);
    return next;
  }

  /**
   * S4.5: the anonymous event counts (architecture 10.3). One call adds a whole batch. The keys are
   * `agg:<WAT date>:<type>:<country>:<university>:<page group>` (src/modules/events/service.ts `countKey`); the daily Cron Trigger
   * (S7.1) reads the `agg:` keys into `event_daily_agg` and clears them. Counts only: no row, no identifier.
   */
  async addCounts(counts: Record<string, number>): Promise<void> {
    const keys = Object.keys(counts).slice(0, 128);
    if (keys.length === 0) return;
    const current = await this.ctx.storage.get<number>(keys);
    // The university and page group in a key come from the client, so a script could invent endless keys. The number of distinct `agg:`
    // keys is capped (`AGG_KEY_CAP`); a key over the cap is not counted. The rollup (S7.1) deletes the `agg:` keys and must also delete
    // `AGG_KEY_COUNT` in the same step.
    const known = (await this.ctx.storage.get<number>(AGG_KEY_COUNT)) ?? 0;
    let room = Math.max(0, AGG_KEY_CAP - known);
    let added = 0;
    const next: Record<string, number> = {};
    for (const key of keys) {
      const seen = current.get(key);
      if (seen === undefined) {
        if (room === 0) continue;
        room -= 1;
        added += 1;
      }
      next[key] = (seen ?? 0) + (counts[key] ?? 0);
    }
    if (added > 0) next[AGG_KEY_COUNT] = known + added;
    await this.ctx.storage.put(next);
  }

  /** The anonymous counts, for the rollup and for tests. */
  async aggregates(): Promise<Record<string, number>> {
    const entries = await this.ctx.storage.list<number>({ prefix: "agg:" });
    return Object.fromEntries(entries);
  }

  /**
   * S7.1: hands every anonymous count out ONCE, for the daily rollup. The `agg:` keys and their key counter are removed in the same
   * call, so the next day starts empty and the 10,000 key cap (`AGG_KEY_CAP`) starts again. A Durable Object runs one call at a
   * time, so a count that arrives meanwhile waits and lands in the next day's keys. If the rollup then fails to save, it calls
   * `restoreAggregates` with what it was given, so nothing is lost.
   */
  async drainAggregates(): Promise<Record<string, number>> {
    const entries = await this.ctx.storage.list<number>({ prefix: "agg:" });
    const keys = [...entries.keys()];
    // `delete` takes at most 128 keys at a time.
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
    await this.ctx.storage.delete(AGG_KEY_COUNT);
    return Object.fromEntries(entries);
  }

  /** Puts counts back (additively) after a failed rollup. Goes through `addCounts`, so the key cap still applies. */
  async restoreAggregates(counts: Record<string, number>): Promise<void> {
    const entries = Object.entries(counts);
    for (let i = 0; i < entries.length; i += 128) await this.addCounts(Object.fromEntries(entries.slice(i, i + 128)));
  }

  async snapshot(): Promise<Record<string, number>> {
    const entries = await this.ctx.storage.list<number>({ prefix: "count:" });
    return Object.fromEntries(Array.from(entries, ([key, value]) => [key.slice("count:".length), value]));
  }

  async recordCron(scheduledTime: number): Promise<void> {
    await this.ctx.storage.put("last_cron", scheduledTime);
  }

  async lastCron(): Promise<number | null> {
    return (await this.ctx.storage.get<number>("last_cron")) ?? null;
  }
}
