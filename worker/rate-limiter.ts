import { DurableObject } from "cloudflare:workers";
import { consume, type LimitDecision, type WindowState } from "../src/server/security/rate-limit";

/**
 * S0.7: Durable Object rate limiter (ADR-027). One instance per salted key; the key is a hash, so no
 * raw IP address ever reaches storage. SQLite-backed, which is what the Workers Free plan allows.
 */
export class RateLimiter extends DurableObject<CloudflareEnv> {
  async hit(limit: number, windowMs: number, cost: 0 | 1 = 1): Promise<LimitDecision> {
    const state = await this.ctx.storage.get<WindowState>("window");
    const now = Date.now();
    const { decision, state: next } = consume(state, now, limit, windowMs, cost);
    // Only a call that changes the count is written (a look, or a refused try, changes nothing), and the cleanup alarm is set once, when
    // a new window starts. This was two writes on every call, which spends the free daily write quota twice as fast.
    if (cost === 0 || !decision.allowed) return decision;
    await this.ctx.storage.put("window", next);
    if (!state || state.resetAt <= now) {
      // Remove the entry once the window has passed, so idle keys leave nothing behind.
      await this.ctx.storage.setAlarm(next.resetAt + 1000);
    }
    return decision;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<WindowState>("window");
    if (!state || state.resetAt <= Date.now()) await this.ctx.storage.deleteAll();
  }
}
