/**
 * WAT time helpers (architecture 7 and 10.7). All times are stored in UTC; display, SLA weekday and rollup dates are
 * computed in WAT (`Africa/Douala`). WAT is UTC+1 all year with no daylight saving, so a fixed offset is exact and
 * needs no timezone database (smaller bundle, same answer on the Worker, in tests and in the browser).
 */

export const WAT_TIMEZONE = "Africa/Douala";
export const WAT_OFFSET_MS = 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface WatParts {
  year: number;
  /** 1 to 12 */
  month: number;
  /** 1 to 31 */
  day: number;
  /** 0 to 23 */
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday, in WAT */
  weekday: number;
}

function assertValid(date: Date): void {
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
}

/** The calendar fields of this instant as read on a WAT wall clock. */
export function watParts(date: Date): WatParts {
  assertValid(date);
  // Shift by the offset, then read the UTC fields of the shifted instant.
  const s = new Date(date.getTime() + WAT_OFFSET_MS);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
    second: s.getUTCSeconds(),
    weekday: s.getUTCDay(),
  };
}

/** Saturday or Sunday in WAT. */
export function isWatWeekend(date: Date): boolean {
  const { weekday } = watParts(date);
  return weekday === 0 || weekday === 6;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The WAT calendar date as `YYYY-MM-DD` (the key of `event_daily_agg.date`). */
export function watDateString(date: Date): string {
  const p = watParts(date);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** For example `2026-10-23 23:00 WAT`. */
export function formatWat(date: Date): string {
  const p = watParts(date);
  return `${watDateString(date)} ${pad(p.hour)}:${pad(p.minute)} WAT`;
}

/** The UTC instant at which this WAT calendar day began (00:00 WAT). */
export function startOfWatDay(date: Date): Date {
  const p = watParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - WAT_OFFSET_MS);
}

/** Builds the UTC instant for a WAT wall-clock time. Month is 1 to 12. */
export function watToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - WAT_OFFSET_MS);
}
