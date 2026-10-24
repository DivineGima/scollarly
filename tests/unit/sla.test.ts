import { describe, expect, it } from "vitest";
import { computeSla, DEFAULT_SLA_SETTINGS, isOverdue, slaSettingsFrom, slaStatus } from "@/modules/sla/service";
import { formatWat, watToUtc } from "@/lib/time";

// 2026-10-19 is a Monday, 2026-10-23 a Friday, 2026-10-24 a Saturday, 2026-10-25 a Sunday, 2026-10-26 a Monday (WAT).
const wat = (day: number, hour: number, minute = 0, second = 0) => watToUtc(2026, 10, day, hour, minute, second);

describe("computeSla (FR-12, architecture 10.7)", () => {
  it("Monday midday WAT gets 4 hours", () => {
    const result = computeSla(wat(19, 12));
    expect(result.hoursApplied).toBe(4);
    expect(formatWat(result.dueAt)).toBe("2026-10-19 16:00 WAT");
  });

  it("Friday 23:00 WAT gets 4 hours and is due Saturday 03:00 WAT (the clock runs across midnight and the weekend)", () => {
    const result = computeSla(wat(23, 23));
    expect(result.hoursApplied).toBe(4);
    expect(formatWat(result.dueAt)).toBe("2026-10-24 03:00 WAT");
  });

  it("Saturday 00:00 WAT gets 24 hours", () => {
    const result = computeSla(wat(24, 0));
    expect(result.hoursApplied).toBe(24);
    expect(formatWat(result.dueAt)).toBe("2026-10-25 00:00 WAT");
  });

  it("Sunday 00:00 WAT gets 24 hours and is due Monday 00:00 WAT", () => {
    const result = computeSla(wat(25, 0));
    expect(result.hoursApplied).toBe(24);
    expect(formatWat(result.dueAt)).toBe("2026-10-26 00:00 WAT");
  });

  it("Sunday 23:59:59 WAT still gets 24 hours, with no recalculation when it crosses into Monday", () => {
    const result = computeSla(wat(25, 23, 59, 59));
    expect(result.hoursApplied).toBe(24);
    expect(formatWat(result.dueAt)).toBe("2026-10-26 23:59 WAT");
  });

  it("the weekday is read in WAT, not UTC: Friday 23:30 UTC is Saturday 00:30 WAT", () => {
    const fridayUtc2330 = new Date("2026-10-23T23:30:00Z");
    expect(computeSla(fridayUtc2330).hoursApplied).toBe(24);
    // And Sunday 23:30 UTC is already Monday 00:30 WAT.
    expect(computeSla(new Date("2026-10-25T23:30:00Z")).hoursApplied).toBe(4);
  });

  it("the last second of Friday WAT is a weekday and the first second of Saturday WAT is a weekend", () => {
    expect(computeSla(wat(23, 23, 59, 59)).hoursApplied).toBe(4);
    expect(computeSla(wat(24, 0, 0, 0)).hoursApplied).toBe(24);
    expect(computeSla(wat(26, 0, 0, 0)).hoursApplied).toBe(4);
  });

  it("uses the 24 hours rule at the weekend whatever time of day the lead arrives", () => {
    for (const hour of [0, 6, 12, 18, 23]) {
      expect(computeSla(wat(24, hour)).hoursApplied, `Saturday ${hour}:00`).toBe(24);
      expect(computeSla(wat(25, hour)).hoursApplied, `Sunday ${hour}:00`).toBe(24);
    }
  });

  it("uses the configured hours, and the stored hours are the ones applied at that moment", () => {
    const monday = computeSla(wat(19, 9), { weekdayHours: 2, weekendHours: 48 });
    expect(monday.hoursApplied).toBe(2);
    expect(computeSla(wat(24, 9), { weekdayHours: 2, weekendHours: 48 }).hoursApplied).toBe(48);
    // Changing the settings afterwards cannot change what was already computed: it is a pure function of its inputs.
    expect(computeSla(wat(19, 9)).hoursApplied).toBe(DEFAULT_SLA_SETTINGS.weekdayHours);
  });

  it("is the same instant arithmetic whether or not the instant is a whole second", () => {
    const received = new Date("2026-10-19T11:00:00.123Z");
    expect(computeSla(received).dueAt.getTime() - received.getTime()).toBe(4 * 3600_000);
  });

  it("refuses an invalid date and unusable hours", () => {
    expect(() => computeSla(new Date("nope"))).toThrow(RangeError);
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, 721]) {
      expect(() => computeSla(wat(19, 9), { weekdayHours: bad, weekendHours: 24 })).toThrow(RangeError);
      expect(() => computeSla(wat(19, 9), { weekdayHours: 4, weekendHours: bad })).toThrow(RangeError);
    }
  });
});

describe("slaSettingsFrom", () => {
  it("reads the two site_setting values", () => {
    expect(slaSettingsFrom({ sla_weekday_hours: 6, sla_weekend_hours: 36 })).toEqual({ weekdayHours: 6, weekendHours: 36 });
  });

  it("falls back to 4 and 24 for missing, null, text, zero, negative, fractional and huge values", () => {
    for (const bad of [undefined, null, "4", 0, -3, 2.5, 100000]) {
      expect(slaSettingsFrom({ sla_weekday_hours: bad, sla_weekend_hours: bad })).toEqual({ weekdayHours: 4, weekendHours: 24 });
    }
    expect(slaSettingsFrom({})).toEqual({ weekdayHours: 4, weekendHours: 24 });
  });
});

describe("isOverdue and slaStatus use the stored target and never recalculate", () => {
  const due = wat(23, 23).getTime() + 4 * 3600_000; // Saturday 03:00 WAT
  const lead = { slaDueAt: new Date(due), firstResponseAt: null };

  it("is open up to and including the target, overdue after it", () => {
    expect(isOverdue(lead, new Date(due - 1))).toBe(false);
    expect(isOverdue(lead, new Date(due))).toBe(false);
    expect(isOverdue(lead, new Date(due + 1))).toBe(true);
    expect(slaStatus(lead, new Date(due))).toBe("open");
    expect(slaStatus(lead, new Date(due + 1))).toBe("overdue");
  });

  it("a logged first reply makes it met and never overdue", () => {
    const answered = { slaDueAt: new Date(due), firstResponseAt: new Date(due - 60_000) };
    expect(isOverdue(answered, new Date(due + 86_400_000))).toBe(false);
    expect(slaStatus(answered, new Date(due + 86_400_000))).toBe("met");
  });
});
