import { DurableObject } from "cloudflare:workers";
import { consume, type LimitDecision, type WindowState } from "../src/server/security/rate-limit";

/**
 * S0.7: Durable Object rate limiter (ADR-027). One instance per salted key; the key is a hash, so no
 * raw IP address ever reaches storage. SQLite-backed, which is what the Workers Free plan allows.
 */
export class RateLimiter extends DurableObject<CloudflareEnv> {
  async hit(limit: number, windowMs: number): Promise<LimitDecision> {
    const state = await this.ctx.storage.get<WindowState>("window");
    const { decision, state: next } = consume(state, Date.now(), limit, windowMs);
    await this.ctx.storage.put("window", next);
    // Remove the entry once the window has passed, so idle keys leave nothing behind.
    await this.ctx.storage.setAlarm(next.resetAt + 1000);
    return decision;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<WindowState>("window");
    if (!state || state.resetAt <= Date.now()) await this.ctx.storage.deleteAll();
  }
}
