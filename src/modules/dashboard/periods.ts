import { DAY_MS, startOfWatDay, watDateString } from "@/lib/time";

/**
 * The dashboard's periods and numbers (architecture 21.9, F18), as pure functions so the maths is tested without a database or a clock.
 *
 *  - `week`: the last 7 days in West Africa Time, today included, against the 7 days before them.
 *  - `month`: the last 30 days against the 30 before.
 * A day is a WAT calendar day (UTC+1, no daylight saving), so "today" starts at 23:00 UTC the evening before.
 */

export const PERIODS = ["week", "month"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_DAYS: Readonly<Record<Period, number>> = { week: 7, month: 30 };

export function readPeriod(value: string | null | undefined): Period {
  return value === "month" ? "month" : "week";
}

export interface PeriodWindows {
  period: Period;
  days: number;
  /** The first instant of the earlier period, the first of this one, and the end of today (exclusive). */
  prevStart: Date;
  curStart: Date;
  curEnd: Date;
  /** The WAT calendar days of this period, oldest first (`YYYY-MM-DD`). */
  labels: string[];
}

export function periodWindows(now: Date, period: Period): PeriodWindows {
  const days = PERIOD_DAYS[period];
  const todayStart = startOfWatDay(now);
  const curEnd = new Date(todayStart.getTime() + DAY_MS);
  const curStart = new Date(curEnd.getTime() - days * DAY_MS);
  const prevStart = new Date(curStart.getTime() - days * DAY_MS);
  const labels = Array.from({ length: days }, (_, i) => watDateString(new Date(curStart.getTime() + i * DAY_MS + DAY_MS / 2)));
  return { period, days, prevStart, curStart, curEnd, labels };
}

/** Counts per WAT day for the days of a period; a day with nothing is zero, and a day outside the period is ignored. */
export function fillSeries(labels: readonly string[], rows: readonly { day: string; n: number }[]): { label: string; value: number }[] {
  const byDay = new Map(rows.map((row) => [row.day.slice(0, 10), row.n]));
  return labels.map((label) => ({ label, value: byDay.get(label) ?? 0 }));
}

export interface Change {
  /** This period minus the one before. */
  delta: number;
  /** Whole percent against the earlier period, or null when the earlier one was zero (a percentage of nothing). */
  percent: number | null;
  direction: "up" | "down" | "same";
}

export function changeOf(value: number, previous: number | null): Change | null {
  if (previous === null) return null;
  const delta = value - previous;
  return { delta, percent: previous === 0 ? null : Math.round((delta / previous) * 100), direction: delta > 0 ? "up" : delta < 0 ? "down" : "same" };
}

/** US dollars from cents, for the owner's payments tile. */
export function dollarsFromCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
