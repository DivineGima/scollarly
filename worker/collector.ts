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
