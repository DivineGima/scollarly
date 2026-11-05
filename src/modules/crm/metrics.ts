/**
 * The CRM numbers (PRD_3 F18 amended, architecture 22.8, ADR-057), as pure functions so the maths and the CSV are tested without a database.
 * Nothing here knows about HTTP or SQL: the repository counts, these functions turn counts into the figures a chart shows.
 */

/** `all` is everything the caller may see, `me` the leads assigned to the caller, `unassigned` the ones nobody has taken. */
export const ASSIGNED = ["all", "me", "unassigned"] as const;
export type Assigned = (typeof ASSIGNED)[number];

export interface Slice {
  key: string;
  count: number;
}

/** Whole percent of `part` in `whole`, or null when there is nothing to compare with (never 0 % of nothing, never NaN). */
export function percentOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/**
 * The biggest `limit` slices and one "other" slice for the rest, largest first, so a chart never has twenty bars and no lead goes missing from
 * the total. Zero slices are dropped; the order of equal counts is by key so the chart does not jump between loads.
 */
export function topSlices(rows: readonly Slice[], limit: number, otherKey = "other"): Slice[] {
  const sorted = rows.filter((row) => row.count > 0).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((sum, row) => sum + row.count, 0);
  return [...head, { key: otherKey, count: rest }];
}

export interface StageCount {
  code: string;
  position: number;
  count: number;
}

export interface FunnelStep {
  code: string;
  /** Leads that have reached this stage or any later one. */
  reached: number;
  /** Share of all leads in the range, and of the step before. */
  ofAll: number | null;
  ofPrevious: number | null;
}

/**
 * A funnel from the leads' CURRENT stage: a lead at "visa" has gone through every earlier stage, so each step counts the leads at that stage or
 * later. `ofPrevious` is the conversion from the step before it. Stages are ordered by position, whatever order they arrive in.
 */
export function funnelFromStages(stages: readonly StageCount[]): FunnelStep[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const total = ordered.reduce((sum, stage) => sum + stage.count, 0);
  let later = 0;
  const reachedByIndex = new Array<number>(ordered.length).fill(0);
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    later += ordered[i]?.count ?? 0;
    reachedByIndex[i] = later;
  }
  return ordered.map((stage, i) => ({
    code: stage.code,
    reached: reachedByIndex[i] ?? 0,
    ofAll: percentOf(reachedByIndex[i] ?? 0, total),
    ofPrevious: i === 0 ? null : percentOf(reachedByIndex[i] ?? 0, reachedByIndex[i - 1] ?? 0),
  }));
}

/** The code of the first funnel step, before the stages: students who finished their profile (PRD_4 F27). */
export const ONBOARDED_STEP = "profile_onboarded";

/**
 * The funnel with its first step in front: students who finished onboarding, then the stages as before. The stage steps are unchanged (a lead is
 * still counted from the lead's own stage), and the first stage gets no "of previous" share, because profiles and leads are counted for the same
 * dates but are not nested (a lead can come from an older flow or from a person onboarded before the range). The share of onboarded students who
 * applied is `appliedOfOnboardedPercent`, shown on its own. Null `onboarded` (a filter a profile does not have) leaves the funnel as it was.
 */
export function withOnboardedStep(steps: readonly FunnelStep[], onboarded: number | null): FunnelStep[] {
  if (onboarded === null) return [...steps];
  return [{ code: ONBOARDED_STEP, reached: onboarded, ofAll: null, ofPrevious: null }, ...steps];
}

/** "12 min", "3 h 20 min", "2 days": a response time for a tile. Null (nobody has answered yet) is left to the caller to word. */
export function formatMinutes(minutes: number | null): { unit: "minutes" | "hours" | "days"; value: number } | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return { unit: "minutes", value: Math.max(1, Math.round(minutes)) };
  if (minutes < 60 * 48) return { unit: "hours", value: Math.round((minutes / 60) * 10) / 10 };
  return { unit: "days", value: Math.round((minutes / 60 / 24) * 10) / 10 };
}

// ---- CSV -------------------------------------------------------------------------------------------------------------------

/**
 * One CSV cell. A value that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is read as a formula by spreadsheet programs, so it gets a
 * leading apostrophe (the standard defence against CSV injection); a value with a comma, quote or line break is quoted and its quotes doubled.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

/** The whole file: a header line and the rows, with a byte order mark so a spreadsheet opens it as UTF-8, and a final newline. */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return `﻿${[csvLine(header), ...rows.map(csvLine)].join("\r\n")}\r\n`;
}
