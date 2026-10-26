import { watDateString } from "@/lib/time";

/**
 * Payments received from universities (architecture 7.6, 10.6; S9.1, S9.2): the pure rules. Money is whole US cents in a bigint column
 * and a JavaScript integer in code; it is never a float. The screen takes dollars as text and this file is the only place that turns
 * the text into cents, so what the person typed is what is stored.
 */

/** The largest single payment accepted, in cents: one hundred million dollars. A typo guard, far above any real placement fee. */
export const MAX_PAYMENT_CENTS = 100_000_000 * 100;

const WITH_GROUPS = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
const PLAIN = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * "1500", "1500.5", "1,500.50" -> cents. Anything else (a sign, a currency symbol, three decimals, exponent notation, zero, too large)
 * is null, so the form shows an error instead of guessing.
 */
export function parseUsdToCents(text: string): number | null {
  const value = text.trim();
  if (!PLAIN.test(value) && !WITH_GROUPS.test(value)) return null;
  const [whole = "0", fraction = ""] = value.replace(/,/g, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents > 0 && cents <= MAX_PAYMENT_CENTS ? cents : null;
}

/** 123456 -> "1,234.56" */
export function formatUsd(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${whole.toLocaleString("en-US")}.${fraction}`;
}

/** 123456 -> "1234.56": plain digits for a spreadsheet cell. */
export function plainUsd(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** A real calendar date written YYYY-MM-DD (so 2026-02-30 is refused, which a regular expression alone would allow). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** FR-17: a payment cannot be dated after today. "Today" is the WAT calendar day, whatever the viewer's own time zone. */
export function isFutureDate(receivedOn: string, now: Date): boolean {
  return receivedOn > watDateString(now);
}
