import { describe, expect, it } from "vitest";
import { consume, limiterKey, type WindowState } from "@/server/security/rate-limit";

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
