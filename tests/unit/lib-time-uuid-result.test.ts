import { describe, expect, it } from "vitest";
import { err, mapResult, ok, unwrap } from "@/lib/result";
import { isUuid, randomUuid, uuidv7 } from "@/lib/uuid";
import { formatWat, isWatWeekend, startOfWatDay, watDateString, watParts, watToUtc } from "@/lib/time";
import { pickTranslation } from "@/lib/translations";

describe("WAT helpers (UTC+1, no daylight saving)", () => {
  it("reads the wall clock in WAT", () => {
    expect(watParts(new Date("2026-10-23T22:00:00Z"))).toEqual({ year: 2026, month: 10, day: 23, hour: 23, minute: 0, second: 0, weekday: 5 });
    expect(watParts(new Date("2026-10-23T23:30:00Z"))).toMatchObject({ day: 24, hour: 0, minute: 30, weekday: 6 });
  });

  it("is UTC+1 in every month (no DST)", () => {
    for (const month of [1, 4, 7, 10, 12]) {
      const utc = new Date(Date.UTC(2026, month - 1, 15, 12, 0, 0));
      expect(watParts(utc).hour, `month ${month}`).toBe(13);
    }
  });

  it("finds the weekend in WAT, not in UTC", () => {
    expect(isWatWeekend(new Date("2026-10-23T22:59:59Z"))).toBe(false); // Friday 23:59:59 WAT
    expect(isWatWeekend(new Date("2026-10-23T23:00:00Z"))).toBe(true); // Saturday 00:00 WAT
    expect(isWatWeekend(new Date("2026-10-25T22:59:59Z"))).toBe(true); // Sunday 23:59:59 WAT
    expect(isWatWeekend(new Date("2026-10-25T23:00:00Z"))).toBe(false); // Monday 00:00 WAT
  });

  it("gives the WAT date for rollups: an event at 23:30 WAT counts for that WAT date (S7.1)", () => {
    expect(watDateString(new Date("2026-10-23T22:30:00Z"))).toBe("2026-10-23");
    expect(watDateString(new Date("2026-10-23T23:00:00Z"))).toBe("2026-10-24");
    expect(watDateString(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("formats and builds WAT instants, and finds the start of a WAT day", () => {
    expect(formatWat(new Date("2026-10-23T22:00:00Z"))).toBe("2026-10-23 23:00 WAT");
    expect(watToUtc(2026, 10, 23, 23, 0).toISOString()).toBe("2026-10-23T22:00:00.000Z");
    expect(startOfWatDay(new Date("2026-10-23T22:30:00Z")).toISOString()).toBe("2026-10-22T23:00:00.000Z");
    expect(startOfWatDay(new Date("2026-10-23T23:30:00Z")).toISOString()).toBe("2026-10-23T23:00:00.000Z");
  });

  it("refuses an invalid date", () => {
    expect(() => watParts(new Date("nope"))).toThrow(RangeError);
  });
});

describe("pickTranslation (ADR-008)", () => {
  it("falls back to English, then to the given fallback", () => {
    expect(pickTranslation({ en: "Fees", fr: "Frais" }, "fr")).toBe("Frais");
    expect(pickTranslation({ en: "Fees" }, "fr")).toBe("Fees");
    expect(pickTranslation({ en: "Fees", fr: "" }, "fr")).toBe("Fees");
    expect(pickTranslation({}, "fr", "n/a")).toBe("n/a");
    expect(pickTranslation(null, "en")).toBe("");
  });
});

describe("uuidv7", () => {
  const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("matches the RFC 9562 example", () => {
    const random = Uint8Array.from([0, 0, 0, 0, 0, 0, 0x0c, 0xc3, 0x18, 0xc4, 0xdc, 0x0c, 0x0c, 0x07, 0x39, 0x8f]);
    expect(uuidv7(0x017f22e279b0, random)).toBe("017f22e2-79b0-7cc3-98c4-dc0c0c07398f");
  });

  it("has version 7, variant 10 and the timestamp in the first 48 bits", () => {
    const now = Date.now();
    const id = uuidv7(now);
    expect(id).toMatch(V7);
    expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(now);
  });

  it("sorts by time", () => {
    const ids = [3000, 1000, 2000, 1000 + 2 ** 40].map((t) => uuidv7(t));
    expect([...ids].sort()).toEqual([ids[1], ids[2], ids[0], ids[3]]);
  });

  it("is random in the remaining bits and does not repeat", () => {
    expect(new Set(Array.from({ length: 5000 }, () => uuidv7(1))).size).toBe(5000);
  });

  it("keeps working past 2^32 milliseconds (no 32-bit shift overflow)", () => {
    const id = uuidv7(2 ** 40 + 12345);
    expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(2 ** 40 + 12345);
  });

  it("refuses an out-of-range time and too few random bytes", () => {
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError);
    expect(() => uuidv7(1.5)).toThrow(RangeError);
    expect(() => uuidv7(1, new Uint8Array(8))).toThrow(RangeError);
  });

  it("isUuid", () => {
    expect(isUuid(uuidv7())).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(5)).toBe(false);
  });
});

describe("randomUuid", () => {
  it("is a version 4 UUID", () => {
    expect(randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("still works in a browser that has no crypto.randomUUID", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const a = randomUuid();
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(randomUuid()).not.toBe(a);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});

describe("Result", () => {
  it("carries a value or an error", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("bad")).toEqual({ ok: false, error: "bad" });
    expect(mapResult(ok(2), (n) => n * 2)).toEqual({ ok: true, value: 4 });
    expect(mapResult(err("bad"), (n: number) => n * 2)).toEqual({ ok: false, error: "bad" });
  });

  it("unwrap returns a value and throws on an error", () => {
    expect(unwrap(ok("x"))).toBe("x");
    expect(() => unwrap(err("nope"))).toThrow(/nope/);
    expect(() => unwrap(err({ code: 1 }))).toThrow(/code/);
  });
});
