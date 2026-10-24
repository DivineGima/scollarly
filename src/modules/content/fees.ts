import { CURRENCIES } from "@/lib/constants";

/**
 * Fee gating (FR-2, architecture 7.3, 16 A3): a fee is shown only when the owner confirmed it and the range is real.
 * Anything else shows "Fees to be confirmed" with a WhatsApp button. A fee is never rendered as 0, as a blank, or as the
 * sum of two currencies. The database has the same rule as a CHECK (`fee_structure_confirmed_range`); this is the second
 * lock, applied where the page is built.
 */

export type Currency = (typeof CURRENCIES)[number];

export interface FeeRowLike {
  currency: string;
  dataConfirmed: boolean;
  /** Postgres `numeric` arrives as a string, for example "3000.00". */
  amountMin: string | number | null;
  amountMax: string | number | null;
}

function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** The validated range of a fee row, or null when the row must not be shown. */
export function confirmedRange(row: FeeRowLike): { currency: Currency; min: number; max: number } | null {
  if (!row.dataConfirmed || !isCurrency(row.currency)) return null;
  const min = toNumber(row.amountMin);
  const max = toNumber(row.amountMax);
  if (min === null || max === null || min <= 0 || max < min) return null;
  return { currency: row.currency, min, max };
}

/** `3,000` or `1,920.50`: the same on every device, because the format never depends on the visitor's locale settings. */
export function formatAmount(amount: number): string {
  const whole = Number.isInteger(amount);
  const [integer = "0", fraction = ""] = amount.toFixed(whole ? 0 : 2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** `USD 3,000 – 6,000`, or `USD 3,000` when both ends are equal. */
export function formatRange(line: { currency: Currency; min: number; max: number }): string {
  return line.min === line.max
    ? `${line.currency} ${formatAmount(line.min)}`
    : `${line.currency} ${formatAmount(line.min)} – ${formatAmount(line.max)}`;
}
