import { sha256Hex } from "@/lib/hash";

/**
 * Rate limiting building blocks (ADR-027). In-memory limiting does not work on Workers, so the state
 * lives in a Durable Object (`worker/rate-limiter.ts`). This file holds the pure logic so it is unit
 * tested without a runtime, plus the key hashing that keeps raw IP addresses out of storage.
 */

export interface WindowState {
  count: number;
  /** Epoch ms when the current window ends. */
  resetAt: number;
}

export interface LimitDecision {
  allowed: boolean;
  remaining: number;
  /** Seconds until the caller may retry. 0 when allowed. */
  retryAfterSeconds: number;
}

/** Fixed window counter. Returns the decision and the state to persist. */
export function consume(
  state: WindowState | undefined,
  now: number,
  limit: number,
  windowMs: number,
): { decision: LimitDecision; state: WindowState } {
  const current = state && state.resetAt > now ? state : { count: 0, resetAt: now + windowMs };
  if (current.count >= limit) {
    return {
      decision: { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) },
      state: current,
    };
  }
  const next = { count: current.count + 1, resetAt: current.resetAt };
  return { decision: { allowed: true, remaining: limit - next.count, retryAfterSeconds: 0 }, state: next };
}

/**
 * Limiter key. The IP is hashed together with the route and a daily salt immediately, so the raw
 * address is never stored or logged and the hash cannot be linked across days.
 */
export async function limiterKey(parts: { route: string; ip: string | null }, secret: string, now: Date = new Date()): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  const salted = await sha256Hex(`${secret}:${day}:${parts.route}:${parts.ip ?? "unknown"}`);
  return salted.slice(0, 32);
}

/** The Durable Object stub shape used for RPC. */
export interface LimiterStub {
  hit(limit: number, windowMs: number): Promise<LimitDecision>;
}

export type Limiter = (key: string, limit: number, windowMs: number) => Promise<LimitDecision>;

export function createDurableObjectLimiter(namespace: DurableObjectNamespace): Limiter {
  return async (key, limit, windowMs) => {
    const stub = namespace.get(namespace.idFromName(key)) as unknown as LimiterStub;
    return stub.hit(limit, windowMs);
  };
}
