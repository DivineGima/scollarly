/**
 * Usage levels for the Health page and the daily usage check (S10.2; architecture 13.2, 16 C7). Pure.
 *
 * The database budget is the safer figure the capacity estimates use (architecture section 3): Neon's plans page has said both 0.5 GB and
 * 1 GB for the free plan, so the check warns against 0.5 GiB and is never caught out by the smaller number. The image budget is the owner's
 * setting. Both warn from 70% (the banner of FR-18) and are urgent from 90%.
 */

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

/** Neon free-plan storage, taken at the smaller of the two published figures. */
export const DATABASE_BUDGET_BYTES = 512 * MIB;

export const WARN_AT = 0.7;
export const URGENT_AT = 0.9;

export type UsageLevel = "ok" | "warn" | "urgent";

export interface Usage {
  usedBytes: number;
  budgetBytes: number;
  /** 0 to more than 1; 1 means the whole budget. */
  ratio: number;
  level: UsageLevel;
}

export function usageOf(usedBytes: number, budgetBytes: number): Usage {
  // A zero budget cannot be divided by; any use of it counts as ten times over (a finite number, because JSON cannot carry Infinity).
  const ratio = budgetBytes > 0 ? usedBytes / budgetBytes : usedBytes > 0 ? 10 : 0;
  return { usedBytes, budgetBytes, ratio, level: ratio >= URGENT_AT ? "urgent" : ratio >= WARN_AT ? "warn" : "ok" };
}

/** "512 MiB", "3.5 GiB", "12.3 KiB": one place, so the page, the log line and the tests agree. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes >= GIB) return `${trim(bytes / GIB)} GiB`;
  if (bytes >= MIB) return `${trim(bytes / MIB)} MiB`;
  if (bytes >= 1024) return `${trim(bytes / 1024)} KiB`;
  return `${Math.round(bytes)} B`;
}

const trim = (n: number) => String(Math.round(n * 10) / 10);

/** The structured line the daily job writes to Workers Logs. Sizes and levels only: no row, no name, no identifier. */
export function usageLogLine(database: Usage, images: Usage): string {
  const worst = database.level === "urgent" || images.level === "urgent" ? "urgent" : database.level === "warn" || images.level === "warn" ? "warn" : "ok";
  return JSON.stringify({
    level: worst === "ok" ? "info" : "warn",
    job: "usage",
    databaseBytes: database.usedBytes,
    databasePercent: Math.round(database.ratio * 100),
    imageBytes: images.usedBytes,
    imagePercent: Math.round(images.ratio * 100),
    status: worst,
  });
}
