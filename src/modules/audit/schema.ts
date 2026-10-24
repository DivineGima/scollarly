import { z } from "zod";
import { watToUtc } from "@/lib/time";

/**
 * The query string of the Audit page (C5): who, what, and a WAT date range. Everything is optional. Dates are WAT calendar
 * days (`YYYY-MM-DD`), turned into UTC instants here so the database only ever sees UTC (CLAUDE.md).
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const token = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);

export const auditQuery = z.strictObject({
  actor: token.optional(),
  action: z.string().regex(/^[A-Za-z][A-Za-z0-9._]{0,63}$/).optional(),
  from: day.optional(),
  to: day.optional(),
  // The id of the last row already shown.
  before: z.uuid().optional(),
});

export type AuditQuery = z.infer<typeof auditQuery>;

function watDayStart(value: string): Date | null {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  // Reject 2026-02-31 and the like: JavaScript would roll it into March.
  const calendar = new Date(Date.UTC(y, m - 1, d));
  if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== m - 1 || calendar.getUTCDate() !== d) return null;
  return watToUtc(y, m, d);
}

export interface AuditRange {
  from?: Date;
  /** Exclusive: the start of the day after the last chosen WAT day. */
  to?: Date;
}

/** Null when a date does not exist, or `from` is after `to`. */
export function watRange(from?: string, to?: string): AuditRange | null {
  const start = from ? watDayStart(from) : undefined;
  const lastDay = to ? watDayStart(to) : undefined;
  if (start === null || lastDay === null) return null;
  const end = lastDay ? new Date(lastDay.getTime() + 24 * 3_600_000) : undefined;
  if (start && end && start >= end) return null;
  return { ...(start ? { from: start } : {}), ...(end ? { to: end } : {}) };
}
