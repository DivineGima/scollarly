import { normalisePhone } from "@/lib/phone";

/**
 * Pure rules of the step-2 form (S17.2; FR-43). No database and no clock of its own, so the same functions run on the phone and the server.
 */

/** Letters and digits, 5 to 20, as the column's check says. The screen asks for upper case; the server stores it that way. */
export const PASSPORT_PATTERN = /^[A-Z0-9]{5,20}$/;

const EARLIEST_BIRTH = "1940-01-01";

/** A real calendar date (no 31 February), not before 1940 and not in the future. */
export function isValidBirthDate(value: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return value >= EARLIEST_BIRTH && value <= now.toISOString().slice(0, 10);
}

/**
 * A parent's phone, to E.164. A number with a `+` is checked as international; one without is read as Cameroon, where the students are
 * (the other countries type the `+`). Returns null when it cannot be right.
 */
export function normaliseFormPhone(input: string): string | null {
  const result = normalisePhone(input, input.trim().startsWith("+") ? undefined : "CM");
  return result.ok ? result.value.e164 : null;
}

export interface ProfileFormRow {
  applicantName: string;
  contactWhatsapp: string;
  courseFields: string[];
  intakeYear: number;
  applicantCountry: string;
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  residenceState: string | null;
  city: string | null;
  address: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  motherName: string | null;
  motherPhone: string | null;
  passportNumber: string | null;
  formCompletedAt: string | null;
}

/**
 * What the form shows when it opens (FR-43: "prefilled"). What the student already told us is filled in; the country they signed up from
 * stands in for the nationality and the country of residence until they say otherwise. Nothing the student has typed is ever overwritten.
 */
export function prefillOf(row: ProfileFormRow, email: string | null) {
  return {
    fixed: { name: row.applicantName, whatsapp: row.contactWhatsapp, email, courseFields: row.courseFields, academicYear: row.intakeYear },
    values: {
      dateOfBirth: row.dateOfBirth ?? "",
      gender: row.gender ?? "",
      nationality: row.nationality ?? row.applicantCountry,
      residenceState: row.residenceState ?? "",
      city: row.city ?? "",
      address: row.address ?? "",
      guardianName: row.guardianName ?? "",
      guardianPhone: row.guardianPhone ?? "",
      motherName: row.motherName ?? "",
      motherPhone: row.motherPhone ?? "",
      passportNumber: row.passportNumber ?? "",
    },
    completed: row.formCompletedAt !== null,
  };
}

export type PassportDecision = { ok: true; store: string | null } | { ok: false };

/** The passport number is asked only when the university asks: required then, and ignored (never stored) otherwise. */
export function decidePassport(required: boolean, value: string | undefined): PassportDecision {
  const given = (value ?? "").trim();
  if (!required) return { ok: true, store: null };
  return given === "" ? { ok: false } : { ok: true, store: given };
}
