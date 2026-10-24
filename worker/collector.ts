import { DurableObject } from "cloudflare:workers";

/**
 * S0.7: Durable Object counter. In Stage 7 this becomes the collector for anonymous event counts
 * (ADR-003, counts only, never rows). In Stage 0 it proves a counter works on the free plan and records
 * the last cron run so the scheduled handler is observable.
 */
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
    const next: Record<string, number> = {};
    for (const key of keys) next[key] = (current.get(key) ?? 0) + (counts[key] ?? 0);
    await this.ctx.storage.put(next);
  }

  /** The anonymous counts, for the rollup and for tests. */
  async aggregates(): Promise<Record<string, number>> {
    const entries = await this.ctx.storage.list<number>({ prefix: "agg:" });
    return Object.fromEntries(entries);
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
