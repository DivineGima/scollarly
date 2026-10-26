import { describe, expect, it, vi } from "vitest";
import { filtersFromSearch, searchFromFilters } from "@/components/admin/analytics-panel";
import { buildFunnel, parseDate, resolveRange } from "@/modules/analytics/funnel";
import { parseCountKey, rowsFromCounts, runDailyRollup, type RollupDeps } from "@/modules/analytics/rollup";
import { countKey } from "@/modules/events/service";
import { rollupLogLine } from "@/server/edge/cron";

const UNI = "0193a8c0-0000-7000-8000-000000000001";

describe("S7.1 collector keys become daily rows", () => {
  it("parses exactly the keys the collector writes", () => {
    const key = countKey({ date: "2026-10-25", type: "page_view", country: "CM", universityId: UNI, pageGroup: "university" });
    expect(parseCountKey(key, 4)).toEqual({ date: "2026-10-25", type: "page_view", country: "CM", universityId: UNI, pageGroup: "university", count: 4 });
    const bare = countKey({ date: "2026-10-25", type: "install", country: null, universityId: null, pageGroup: null });
    expect(parseCountKey(bare, 1)).toEqual({ date: "2026-10-25", type: "install", country: null, universityId: null, pageGroup: null, count: 1 });
  });

  it("drops a key that is not one of ours instead of storing it", () => {
    for (const key of [
      "agg:2026-10-25:page_view:CM:-:nowhere", // not a page group
      "agg:2026-02-30:page_view:CM:-:home", // not a date
      "agg:2026-10-25:bogus:CM:-:home", // not an event type
      "agg:2026-10-25:page_view:cm:-:home", // country must be upper case
      "agg:2026-10-25:page_view:CM:not-a-uuid:home",
      "agg:2026-10-25:page_view:CM:-", // too few parts
      "agg:2026-10-25:page_view:CM:-:home:extra", // too many
      "count:page_view", // another kind of key
      "agg:2026-10-25:page_view:CM:-:home:", // trailing part
    ]) {
      expect(parseCountKey(key, 1), key).toBeNull();
    }
  });

  it("drops a count that is not a positive whole number", () => {
    const key = countKey({ date: "2026-10-25", type: "page_view", country: null, universityId: null, pageGroup: null });
    for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(parseCountKey(key, count), String(count)).toBeNull();
  });

  it("reports how many keys it skipped", () => {
    const good = countKey({ date: "2026-10-25", type: "page_view", country: "GH", universityId: null, pageGroup: "home" });
    const { rows, skipped } = rowsFromCounts({ [good]: 3, junk: 1 });
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe("the daily job as a whole", () => {
  const NOW = new Date("2026-10-26T23:05:00Z"); // 00:05 WAT on the 27th
  const deps = (over: Partial<RollupDeps> = {}): RollupDeps & { saveCounts: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn>; rollRaw: ReturnType<typeof vi.fn> } =>
    ({
      drain: vi.fn(async () => ({ [countKey({ date: "2026-10-26", type: "page_view", country: "CM", universityId: null, pageGroup: "home" })]: 9 })),
      restore: vi.fn(async () => undefined),
      saveCounts: vi.fn(async () => undefined),
      rollRaw: vi.fn(async () => ({ counted: 2, purged: 1 })),
      now: () => NOW,
      ...over,
    }) as never;

  it("saves the counts and rolls the raw rows up to the WAT day that has just begun", async () => {
    const d = deps();
    const result = await runDailyRollup(d);
    expect(result).toEqual({ keys: 1, skipped: 0, rows: 1, rawCounted: 2, rawPurged: 1, failed: [] });
    expect(d.rollRaw).toHaveBeenCalledWith("2026-10-27");
    expect(d.restore).not.toHaveBeenCalled();
  });

  it("puts the counts back when saving fails, and still rolls the raw rows", async () => {
    const d = deps({ saveCounts: vi.fn(async () => { throw new Error("neon down"); }) });
    const result = await runDailyRollup(d);
    expect(result.failed).toEqual(["counts"]);
    expect(d.restore).toHaveBeenCalledTimes(1);
    expect(d.rollRaw).toHaveBeenCalledTimes(1);
  });

  it("says so when even the put-back fails, and when the raw step fails", async () => {
    const d = deps({ saveCounts: vi.fn(async () => { throw new Error("x"); }), restore: vi.fn(async () => { throw new Error("y"); }), rollRaw: vi.fn(async () => { throw new Error("z"); }) });
    expect((await runDailyRollup(d)).failed).toEqual(["counts", "restore", "raw"]);
  });

  it("a collector that cannot be read is reported, and the raw rows are still rolled", async () => {
    const d = deps({ drain: vi.fn(async () => { throw new Error("do down"); }) });
    const result = await runDailyRollup(d);
    expect(result.failed).toEqual(["collector"]);
    expect(d.saveCounts).not.toHaveBeenCalled();
    expect(d.rollRaw).toHaveBeenCalled();
  });

  it("nothing to save is not a failure, and writes nothing", async () => {
    const d = deps({ drain: vi.fn(async () => ({})) });
    const result = await runDailyRollup(d);
    expect(result.failed).toEqual([]);
    expect(d.saveCounts).not.toHaveBeenCalled();
  });

  it("logs counts only: no key, no event, no identifier", () => {
    const line = rollupLogLine({ keys: 3, skipped: 1, rows: 2, rawCounted: 4, rawPurged: 0, failed: ["raw"] });
    expect(JSON.parse(line)).toEqual({ level: "error", job: "rollup", keys: 3, skipped: 1, rows: 2, rawCounted: 4, rawPurged: 0, failed: ["raw"] });
    expect(JSON.parse(rollupLogLine({ keys: 0, skipped: 0, rows: 0, rawCounted: 0, rawPurged: 0, failed: [] })).level).toBe("info");
  });
});

describe("S7.2 the date range (WAT)", () => {
  const now = new Date("2026-10-26T12:00:00Z"); // 13:00 WAT, Monday 26 October

  it("parses real dates only", () => {
    expect(parseDate("2026-10-26")?.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    for (const bad of ["2026-02-30", "2026-13-01", "26-10-2026", "2026-10-26T00:00", "", "tomorrow"]) expect(parseDate(bad), bad).toBeNull();
    expect(parseDate("2028-02-29")).not.toBeNull();
    expect(parseDate("2027-02-29")).toBeNull();
  });

  it("defaults to the last 30 days ending today, and turns the days into WAT instants", () => {
    const r = resolveRange({}, now);
    if ("problem" in r) throw new Error(r.problem);
    expect(r).toMatchObject({ from: "2026-09-27", to: "2026-10-26" });
    // 00:00 WAT is 23:00 UTC the evening before; the end is the first instant after the last day.
    expect(r.start.toISOString()).toBe("2026-09-26T23:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-26T23:00:00.000Z");
  });

  it("uses the WAT date for 'today' even when UTC is still on the day before", () => {
    const lateEvening = new Date("2026-10-26T23:30:00Z"); // 00:30 WAT on the 27th
    const r = resolveRange({}, lateEvening);
    expect("problem" in r ? null : r.to).toBe("2026-10-27");
  });

  it("names the field when the range cannot be used", () => {
    expect(resolveRange({ to: "2026-10-27" }, now)).toEqual({ problem: "FUTURE", field: "to" });
    expect(resolveRange({ from: "2026-10-20", to: "2026-10-10" }, now)).toEqual({ problem: "ORDER", field: "from" });
    expect(resolveRange({ from: "2025-10-01", to: "2026-10-26" }, now)).toEqual({ problem: "TOO_LONG", field: "from" });
    expect(resolveRange({ from: "2026-02-30" }, now)).toEqual({ problem: "INVALID", field: "from" });
    expect(resolveRange({ to: "soon" }, now)).toEqual({ problem: "INVALID", field: "to" });
    expect("problem" in resolveRange({ from: "2025-10-26", to: "2026-10-26" }, now)).toBe(false); // exactly 366 days is allowed
  });
});

describe("S7.2 the funnel", () => {
  const stages = ["share_results", "choose_course", "offer_letter", "confirm_admission", "visa", "arrived"].map((code, i) => ({ code, position: i + 1 }));

  it("counts a stage as reached by every lead at it or after it, so the numbers only fall", () => {
    const leadsByStage = new Map([["share_results", 4], ["choose_course", 3], ["offer_letter", 2], ["arrived", 1]]);
    const rows = buildFunnel({ pageViews: 1000, waTaps: 100, leadsByStage, stages });
    expect(rows.map((r) => [r.key, r.count])).toEqual([
      ["visit", 1000],
      ["wa_tap", 100],
      ["lead", 10],
      ["stage:choose_course", 6],
      ["stage:offer_letter", 3],
      ["stage:confirm_admission", 1],
      ["stage:visa", 1],
      ["stage:arrived", 1],
    ]);
    expect(rows[0]?.ratio).toBeNull();
    expect(rows[1]?.ratio).toBeCloseTo(0.1, 6);
    expect(rows[3]?.ratio).toBeCloseTo(0.6, 6);
  });

  it("has no ratio after a step with nothing in it, instead of dividing by zero", () => {
    const rows = buildFunnel({ pageViews: 0, waTaps: 5, leadsByStage: new Map(), stages });
    expect(rows[1]?.ratio).toBeNull();
    expect(rows[2]?.count).toBe(0);
    expect(rows[2]?.ratio).toBe(0);
    expect(rows[3]?.ratio).toBeNull();
  });

  it("leaves out the visit step when page views are not collected, and starts the ratios afresh", () => {
    const rows = buildFunnel({ pageViews: 500, waTaps: 50, leadsByStage: new Map([["share_results", 10]]), stages, includeVisits: false });
    expect(rows[0]?.key).toBe("wa_tap");
    expect(rows[0]?.ratio).toBeNull();
    expect(rows[1]).toMatchObject({ key: "lead", count: 10 });
    expect(rows[1]?.ratio).toBeCloseTo(0.2, 6);
  });

  it("can show a lead count above the taps (not every lead taps first), and says so with a ratio over 100%", () => {
    const rows = buildFunnel({ pageViews: 100, waTaps: 2, leadsByStage: new Map([["share_results", 5]]), stages });
    expect(rows[2]?.ratio).toBeGreaterThan(1);
  });
});

describe("the filters live in the address", () => {
  it("round trips a view, and falls back for anything unknown", () => {
    const filters = { tab: "sources" as const, from: "2026-10-01", to: "2026-10-26", country: "NG", university: UNI };
    expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters);
    expect(filtersFromSearch("?tab=nope&from=2026-10-01").tab).toBe("funnel");
    expect(searchFromFilters({ ...filters, country: "", university: "" })).toBe("?tab=sources&from=2026-10-01&to=2026-10-26");
  });
});
