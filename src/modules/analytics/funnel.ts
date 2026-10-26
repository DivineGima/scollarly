import { DAY_MS, watDateString, watToUtc } from "@/lib/time";

/**
 * The funnel and its date range (S7.2, architecture 16 B10). Pure, so the rules are tested without a database. All dates are WAT
 * calendar dates (`Africa/Douala`): a lead received at 23:30 WAT on the 5th counts for the 5th, a visit counted on the 5th is
 * filed under the 5th, and the same range is applied to both (`event_daily_agg.date` is already a WAT date).
 */

export const DEFAULT_RANGE_DAYS = 30;
/** More than this and the page would be asking for a year of rows; the screen offers 30, 90 and 365 days. */
export const MAX_RANGE_DAYS = 366;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A valid calendar date as a UTC date at midnight, or null (`2026-02-30` is not one). */
export function parseDate(text: string): Date | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

export interface DateRange {
  from: string;
  to: string;
  /** The first instant of `from` in WAT, as a UTC instant. */
  start: Date;
  /** The first instant AFTER `to` in WAT (exclusive end). */
  end: Date;
}

export type RangeProblem = "INVALID" | "ORDER" | "TOO_LONG" | "FUTURE";

/**
 * The range from two WAT dates. `to` may be today but not later. With neither given it is the last 30 days ending today.
 * Returns a problem token instead of throwing, so the endpoint can answer with the field named.
 */
export function resolveRange(input: { from?: string | undefined; to?: string | undefined }, now: Date): DateRange | { problem: RangeProblem; field: "from" | "to" } {
  const today = watDateString(now);
  const toText = input.to ?? today;
  const toDate = parseDate(toText);
  if (!toDate) return { problem: "INVALID", field: "to" };
  const fromText = input.from ?? watDateString(new Date(toDate.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS));
  const fromDate = parseDate(fromText);
  if (!fromDate) return { problem: "INVALID", field: "from" };
  if (toText > today) return { problem: "FUTURE", field: "to" };
  if (fromDate > toDate) return { problem: "ORDER", field: "from" };
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) return { problem: "TOO_LONG", field: "from" };
  const start = watToUtc(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + 1, fromDate.getUTCDate());
  const end = watToUtc(toDate.getUTCFullYear(), toDate.getUTCMonth() + 1, toDate.getUTCDate() + 1);
  return { from: fromText, to: toText, start, end };
}

export interface StageInfo {
  code: string;
  position: number;
}

export type FunnelKey = "visit" | "wa_tap" | "lead" | `stage:${string}`;

export interface FunnelRow {
  key: FunnelKey;
  count: number;
  /** This step as a share of the one before it (0 to 1, can pass 1 for the first three, which are not nested), or null for the first row or when the one before is 0. */
  ratio: number | null;
}

/**
 * The funnel rows: visit (unless page views are not collected), WhatsApp tap, lead, then each stage after the first up to the last. A stage's count is the leads that
 * REACHED it, the leads now at that stage or any later one, so the counts only fall and the drop-off is the share lost.
 * `leadsByStage` holds how many leads are at each stage now.
 */
export function buildFunnel(input: { pageViews: number; waTaps: number; leadsByStage: ReadonlyMap<string, number>; stages: readonly StageInfo[]; includeVisits?: boolean }): FunnelRow[] {
  const stages = [...input.stages].sort((a, b) => a.position - b.position);
  const reached = (position: number) => stages.filter((s) => s.position >= position).reduce((sum, s) => sum + (input.leadsByStage.get(s.code) ?? 0), 0);
  const leads = stages.reduce((sum, s) => sum + (input.leadsByStage.get(s.code) ?? 0), 0);

  // With page-view collection switched off (ADR-003) the top step is gone, and the first row that is left has nothing before it.
  const counts: { key: FunnelKey; count: number }[] = [
    ...(input.includeVisits === false ? [] : [{ key: "visit" as FunnelKey, count: input.pageViews }]),
    { key: "wa_tap", count: input.waTaps },
    { key: "lead", count: leads },
    ...stages.slice(1).map((s) => ({ key: `stage:${s.code}` as FunnelKey, count: reached(s.position) })),
  ];
  return counts.map((row, index) => {
    const before = counts[index - 1]?.count ?? 0;
    return { ...row, ratio: index === 0 || before === 0 ? null : row.count / before };
  });
}
