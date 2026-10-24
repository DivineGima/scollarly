import { err, ok, type Result } from "./result";

/**
 * Phone normaliser (ADR-025): the 7 student countries plus India are checked by their national length, and any other
 * number gets the generic E.164 check. A full phone library is too heavy for the 200 KB budget (architecture 12).
 *
 * The rules are deliberately loose: a number is only refused when its length cannot be right. Refusing a real student's
 * number loses a lead, while accepting a wrong one is caught by the admin at the first WhatsApp message. The national
 * lengths below are the numbers of digits after the country code and without the trunk `0`:
 *  - Cameroon 9, Nigeria 10, Ghana 9, Ivory Coast 10 (the 2021 numbering plan: the leading 0 is part of the number),
 *    Senegal 9, Guinea 9, South Africa 9, India 10.
 */

export type PhoneCountry = "CM" | "NG" | "GH" | "CI" | "SN" | "GN" | "ZA" | "IN";

interface CountryRule {
  callingCode: string;
  nationalLength: number;
  /** The country dials a trunk `0` before the national number, which is dropped in international form. */
  trunkZero: boolean;
  /** Digit groups for the international display form. */
  groups: readonly number[];
}

export const PHONE_RULES: Readonly<Record<PhoneCountry, CountryRule>> = {
  CM: { callingCode: "237", nationalLength: 9, trunkZero: false, groups: [3, 3, 3] },
  NG: { callingCode: "234", nationalLength: 10, trunkZero: true, groups: [3, 3, 4] },
  GH: { callingCode: "233", nationalLength: 9, trunkZero: true, groups: [2, 3, 4] },
  CI: { callingCode: "225", nationalLength: 10, trunkZero: false, groups: [2, 2, 2, 2, 2] },
  SN: { callingCode: "221", nationalLength: 9, trunkZero: false, groups: [2, 3, 2, 2] },
  GN: { callingCode: "224", nationalLength: 9, trunkZero: false, groups: [3, 2, 2, 2] },
  ZA: { callingCode: "27", nationalLength: 9, trunkZero: true, groups: [2, 3, 4] },
  IN: { callingCode: "91", nationalLength: 10, trunkZero: true, groups: [5, 5] },
};

/** Calling codes, longest first, so a three-digit code is tried before a two-digit one. */
const CODES = (Object.entries(PHONE_RULES) as [PhoneCountry, CountryRule][])
  .map(([country, rule]) => ({ country, ...rule }))
  .sort((a, b) => b.callingCode.length - a.callingCode.length);

export type PhoneError = "EMPTY" | "INVALID_CHARACTERS" | "NEEDS_COUNTRY" | "INVALID_LENGTH";

export interface NormalisedPhone {
  /** `+` and 7 to 15 digits, for example `+237612345678`. This is what is stored in `lead.whatsapp_e164`. */
  e164: string;
  /** The recognised country, or null for a number that only passed the generic E.164 check. */
  country: PhoneCountry | null;
  /** The international display form, for example `+237 612 345 678`. */
  display: string;
}

/** The generic E.164 check: a plus, a non-zero first digit, 7 to 15 digits in all. */
export function isE164(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9]\d{6,14}$/.test(value);
}

function groupDigits(digits: string, groups: readonly number[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const size of groups) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  if (at < digits.length) parts.push(digits.slice(at));
  return parts.join(" ");
}

function build(country: PhoneCountry, national: string): NormalisedPhone {
  const rule = PHONE_RULES[country];
  return {
    e164: `+${rule.callingCode}${national}`,
    country,
    display: `+${rule.callingCode} ${groupDigits(national, rule.groups)}`,
  };
}

/** Checks a national number for a known country; strips a trunk `0` that was typed. */
function nationalFor(country: PhoneCountry, digits: string): Result<string, PhoneError> {
  const rule = PHONE_RULES[country];
  let national = digits;
  if (rule.trunkZero && national.startsWith("0")) national = national.slice(1);
  if (national.length !== rule.nationalLength) return err("INVALID_LENGTH");
  // Only Ivory Coast numbers begin with 0 once the country code is removed.
  if (country !== "CI" && national.startsWith("0")) return err("INVALID_LENGTH");
  return ok(national);
}

/**
 * Turns what a person typed into E.164.
 *  - `+237 612 345 678`, `00237612345678` and `237612345678` are read as international.
 *  - A national number such as `0803 123 4567` needs `defaultCountry` (the form's country field).
 *  - A trunk `0` typed after the country code, as in `+234 (0)803 123 4567`, is dropped.
 */
export function normalisePhone(input: string, defaultCountry?: string): Result<NormalisedPhone, PhoneError> {
  if (typeof input !== "string" || input.trim() === "") return err("EMPTY");
  let s = input.trim();
  if (!/^[+\d\s().-]+$/.test(s)) return err("INVALID_CHARACTERS");

  let international = false;
  if (s.startsWith("+")) {
    international = true;
    s = s.slice(1);
  }
  if (s.includes("+")) return err("INVALID_CHARACTERS");
  let digits = s.replace(/[\s().-]/g, "");
  if (digits === "") return err("EMPTY");
  if (!international && digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
  }

  if (international) {
    const known = CODES.find((c) => digits.startsWith(c.callingCode));
    if (known) {
      const national = nationalFor(known.country, digits.slice(known.callingCode.length));
      return national.ok ? ok(build(known.country, national.value)) : national;
    }
    return /^[1-9]\d{6,14}$/.test(digits) ? ok({ e164: `+${digits}`, country: null, display: `+${digits}` }) : err("INVALID_LENGTH");
  }

  const rule = defaultCountry && Object.hasOwn(PHONE_RULES, defaultCountry) ? PHONE_RULES[defaultCountry as PhoneCountry] : undefined;
  if (!defaultCountry || !rule) return err("NEEDS_COUNTRY");
  const country = defaultCountry as PhoneCountry;

  // The country code typed without a plus: 237612345678 for Cameroon.
  if (digits.length === rule.callingCode.length + rule.nationalLength && digits.startsWith(rule.callingCode)) {
    const national = nationalFor(country, digits.slice(rule.callingCode.length));
    if (national.ok) return ok(build(country, national.value));
  }
  const national = nationalFor(country, digits);
  return national.ok ? ok(build(country, national.value)) : national;
}

/**
 * A `tel:` link for a number written for people, for example `+91 98157 25968` becomes `tel:+919815725968`.
 * Null when the text is empty or is not a valid international number, so a page never links to a broken dialler.
 */
export function telHref(display: string | null | undefined): string | null {
  if (!display) return null;
  const compact = display.replace(/[\s().-]/g, "");
  return isE164(compact) ? `tel:${compact}` : null;
}
