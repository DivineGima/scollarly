import { describe, expect, it } from "vitest";
import { consume, createDurableObjectLimiter, limiterKey, type WindowState } from "@/server/security/rate-limit";

describe("consume (fixed window)", () => {
  const WINDOW = 60_000;

  it("allows up to the limit, then refuses with a Retry-After", () => {
    let state: WindowState | undefined;
    const t0 = 1_000_000;
    for (let i = 1; i <= 3; i++) {
      const r = consume(state, t0 + i, 3, WINDOW);
      expect(r.decision.allowed).toBe(true);
      expect(r.decision.remaining).toBe(3 - i);
      state = r.state;
    }
    const blocked = consume(state, t0 + 10, 3, WINDOW);
    expect(blocked.decision.allowed).toBe(false);
    expect(blocked.decision.remaining).toBe(0);
    expect(blocked.decision.retryAfterSeconds).toBeGreaterThanOrEqual(59);
    expect(blocked.decision.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("does not count a refused request", () => {
    const first = consume(undefined, 0, 1, WINDOW);
    const refused = consume(first.state, 1, 1, WINDOW);
    expect(refused.state.count).toBe(1);
  });

  it("starts a fresh window once the old one has ended", () => {
    const first = consume(undefined, 0, 1, WINDOW);
    expect(consume(first.state, WINDOW - 1, 1, WINDOW).decision.allowed).toBe(false);
    const later = consume(first.state, WINDOW + 1, 1, WINDOW);
    expect(later.decision.allowed).toBe(true);
    expect(later.state.count).toBe(1);
  });

  it("never reports a Retry-After below one second", () => {
    const first = consume(undefined, 0, 1, WINDOW);
    expect(consume(first.state, WINDOW - 1, 1, WINDOW).decision.retryAfterSeconds).toBe(1);
  });
});

describe("limiterKey", () => {
  const day = new Date("2026-10-23T10:00:00Z");

  it("never contains the raw IP address", async () => {
    const key = await limiterKey({ route: "leads", ip: "203.0.113.77" }, "secret", day);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
  });

  it("is stable within a day and different across routes, callers and days", async () => {
    const a = await limiterKey({ route: "leads", ip: "203.0.113.77" }, "secret", day);
    expect(await limiterKey({ route: "leads", ip: "203.0.113.77" }, "secret", new Date("2026-10-23T23:59:00Z"))).toBe(a);
    expect(await limiterKey({ route: "events", ip: "203.0.113.77" }, "secret", day)).not.toBe(a);
    expect(await limiterKey({ route: "leads", ip: "203.0.113.78" }, "secret", day)).not.toBe(a);
    expect(await limiterKey({ route: "leads", ip: "203.0.113.77" }, "secret", new Date("2026-10-24T00:00:00Z"))).not.toBe(a);
    expect(await limiterKey({ route: "leads", ip: "203.0.113.77" }, "other-secret", day)).not.toBe(a);
  });

  it("copes with a missing IP", async () => {
    expect(await limiterKey({ route: "leads", ip: null }, "secret", day)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("consume with a cost of 0 (only look)", () => {
  it("uses no try, and still refuses once the budget is spent", () => {
    const first = consume(undefined, 1000, 2, 60_000, 0);
    expect(first.decision.allowed).toBe(true);
    expect(first.state.count).toBe(0);
    const spent: WindowState = { count: 2, resetAt: 61_000 };
    expect(consume(spent, 2000, 2, 60_000, 0).decision.allowed).toBe(false);
    expect(consume({ count: 1, resetAt: 61_000 }, 2000, 2, 60_000, 0).state.count).toBe(1);
  });
});

describe("createDurableObjectLimiter", () => {
  const namespace = (hit: () => Promise<unknown>) =>
    ({ idFromName: (k: string) => k, get: () => ({ hit }) }) as unknown as DurableObjectNamespace;

  it("passes the stub's answer through, with the cost", async () => {
    let seen: unknown[] = [];
    const ns = { idFromName: (k: string) => k, get: () => ({ hit: async (...args: unknown[]) => ((seen = args), { allowed: true, remaining: 1, retryAfterSeconds: 0 }) }) } as unknown as DurableObjectNamespace;
    expect((await createDurableObjectLimiter(ns)("k", 5, 1000, 0)).allowed).toBe(true);
    expect(seen).toEqual([5, 1000, 0]);
  });

  it("never throws: a failing Durable Object means not allowed, retry in 30 seconds", async () => {
    const limiter = createDurableObjectLimiter(namespace(async () => { throw new Error("Exceeded quota"); }));
    await expect(limiter("k", 5, 1000)).resolves.toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
  });
});
