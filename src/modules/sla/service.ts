import { DAY_MS, HOUR_MS, isWatWeekend } from "@/lib/time";

/**
 * The SLA rule (FR-12, architecture 10.7, ADR-009) as a pure function. The target is set once, when the server receives
 * the lead, and is stored on the lead (`sla_due_at`, `sla_hours_applied`); it is never recalculated.
 *
 *  1. `receivedAt` is the server time of the insert, never the device time.
 *  2. The WAT weekday at that moment decides the hours: Monday to Friday use `weekdayHours` (4), Saturday and Sunday use `weekendHours` (24).
 *  3. `dueAt = receivedAt + hours`, on the wall clock, with no pause for nights or weekends.
 *
 * Example: received Friday 23:00 WAT is a weekday, so the target is 4 hours later, Saturday 03:00 WAT.
 */

export interface SlaSettings {
  weekdayHours: number;
  weekendHours: number;
}

/** The defaults in `site_setting` (`sla_weekday_hours`, `sla_weekend_hours`). */
export const DEFAULT_SLA_SETTINGS: Readonly<SlaSettings> = { weekdayHours: 4, weekendHours: 24 };

export interface SlaTarget {
  dueAt: Date;
  /** The hours applied, stored as `lead.sla_hours_applied` so a later settings change never rewrites history. */
  hoursApplied: number;
}

function assertHours(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value * HOUR_MS > 30 * DAY_MS) {
    throw new RangeError(`${name} must be a whole number of hours from 1 to 720`);
  }
}

export function computeSla(receivedAt: Date, settings: SlaSettings = DEFAULT_SLA_SETTINGS): SlaTarget {
  if (Number.isNaN(receivedAt.getTime())) throw new RangeError("receivedAt is not a valid date");
  assertHours("weekdayHours", settings.weekdayHours);
  assertHours("weekendHours", settings.weekendHours);
  const hoursApplied = isWatWeekend(receivedAt) ? settings.weekendHours : settings.weekdayHours;
  return { dueAt: new Date(receivedAt.getTime() + hoursApplied * HOUR_MS), hoursApplied };
}

/**
 * Reads the two hour counts from the `site_setting` rows. A missing or invalid value falls back to the default, so a
 * bad settings row can never stop a lead from being stored.
 */
export function slaSettingsFrom(settings: Readonly<Record<string, unknown>>): SlaSettings {
  const pick = (key: string, fallback: number) => {
    const value = settings[key];
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value * HOUR_MS <= 30 * DAY_MS ? value : fallback;
  };
  return {
    weekdayHours: pick("sla_weekday_hours", DEFAULT_SLA_SETTINGS.weekdayHours),
    weekendHours: pick("sla_weekend_hours", DEFAULT_SLA_SETTINGS.weekendHours),
  };
}

export interface SlaLeadFields {
  slaDueAt: Date;
  firstResponseAt: Date | null;
}

/** Overdue means no reply has been logged and the stored target has passed. It never recalculates (FR-12). */
export function isOverdue(lead: SlaLeadFields, now: Date): boolean {
  return lead.firstResponseAt === null && now.getTime() > lead.slaDueAt.getTime();
}

export type SlaStatus = "met" | "open" | "overdue";

/** `met` once a first reply is logged (S5.2), `overdue` past the stored target with no reply, otherwise `open`. */
export function slaStatus(lead: SlaLeadFields, now: Date): SlaStatus {
  if (lead.firstResponseAt !== null) return "met";
  return isOverdue(lead, now) ? "overdue" : "open";
}
