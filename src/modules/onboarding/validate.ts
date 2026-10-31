import {
  type ProfileRelationship,
  PROFILE_RELATIONSHIPS,
  QUALIFICATION_TYPES,
  STUDENT_COUNTRIES,
  STUDY_LEVELS,
  MAX_COURSE_FIELDS,
} from "@/lib/constants";
import { isCourseField } from "@/lib/courses";
import { normalisePhone } from "@/lib/phone";

/**
 * The rules of the onboarding questionnaire (architecture 21.6, ADR-043) as plain functions with no Zod, so the screens the phone
 * loads stay small. The server's schema (`schema.ts`) calls the same function, so the phone and the server cannot disagree; a unit
 * test feeds both the same cases. Errors are the message tokens of `lib/schemas/common.ts`; the screens map each to a translated text.
 *
 * The student's own details are the "contact" too: for `student`, `contact_name` is the applicant's name and `contact_country` the
 * applicant's country, so the one set of rules covers both people without a second questionnaire.
 */

export type AnswerField =
  | "relationship"
  | "applicant_name"
  | "applicant_country"
  | "contact_name"
  | "contact_country"
  | "contact_whatsapp"
  | "qualification_type"
  | "results"
  | "level"
  | "course_fields"
  | "intake_year";

export type AnswerErrors = Partial<Record<AnswerField | "consent", string>>;

/** What the questionnaire has collected so far. Anything may be missing or the wrong type; `validateAnswers` says what is wrong. */
export type AnswerInput = Partial<Record<AnswerField, unknown>>;

export const NAME_MAX = 100;
export const SUBJECT_MAX = 60;
export const GRADE_MAX = 10;
export const RESULTS_MAX = 30;
export const INTAKE_YEAR_MIN = 2020;
export const INTAKE_YEAR_MAX = 2100;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const oneOf = (list: readonly string[], value: unknown): boolean => typeof value === "string" && list.includes(value);

function checkName(errors: AnswerErrors, field: "applicant_name" | "contact_name", value: unknown): void {
  const name = text(value);
  if (!name) errors[field] = "REQUIRED";
  else if (name.length > NAME_MAX) errors[field] = "TOO_LONG";
}

function checkCountry(errors: AnswerErrors, field: "applicant_country" | "contact_country", value: unknown): void {
  if (!text(value)) errors[field] = "REQUIRED";
  else if (!oneOf(STUDENT_COUNTRIES, value)) errors[field] = "UNKNOWN_VALUE";
}

function checkResults(errors: AnswerErrors, value: unknown): void {
  if (!Array.isArray(value)) {
    errors.results = "INVALID";
    return;
  }
  if (value.length > RESULTS_MAX) {
    errors.results = "TOO_LONG";
    return;
  }
  for (const row of value as unknown[]) {
    const subject = text((row as { subject?: unknown } | null)?.subject);
    const grade = text((row as { grade?: unknown } | null)?.grade);
    if (!subject || !grade) errors.results = "INVALID";
    else if (subject.length > SUBJECT_MAX || grade.length > GRADE_MAX) errors.results = "TOO_LONG";
  }
}

function checkCourseFields(errors: AnswerErrors, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.course_fields = "REQUIRED";
    return;
  }
  if (value.length > MAX_COURSE_FIELDS) errors.course_fields = "TOO_LONG";
  else if (new Set(value).size !== value.length) errors.course_fields = "DUPLICATE";
  else if (!value.every(isCourseField)) errors.course_fields = "UNKNOWN_VALUE";
}

/** Every rule at once. An empty object means the answers are complete and valid. */
export function validateAnswers(input: AnswerInput): AnswerErrors {
  const errors: AnswerErrors = {};

  if (!oneOf(PROFILE_RELATIONSHIPS, input.relationship)) errors.relationship = "UNKNOWN_VALUE";
  checkName(errors, "applicant_name", input.applicant_name);
  checkCountry(errors, "applicant_country", input.applicant_country);
  checkName(errors, "contact_name", input.contact_name);
  checkCountry(errors, "contact_country", input.contact_country);

  if (input.relationship === "student") {
    // The student is their own contact. A body that says otherwise was not made by our screens.
    if (!errors.applicant_name && text(input.contact_name) !== text(input.applicant_name)) errors.contact_name = "INVALID";
    if (!errors.applicant_country && input.contact_country !== input.applicant_country) errors.contact_country = "INVALID";
  }

  if (!text(input.contact_whatsapp)) errors.contact_whatsapp = "REQUIRED";
  else if (errors.contact_country || !normalisePhone(text(input.contact_whatsapp), text(input.contact_country)).ok) errors.contact_whatsapp = "PHONE_INVALID";

  if (!text(input.qualification_type)) errors.qualification_type = "REQUIRED";
  else if (!oneOf(QUALIFICATION_TYPES, input.qualification_type)) errors.qualification_type = "UNKNOWN_VALUE";
  checkResults(errors, input.results);

  if (!text(input.level)) errors.level = "REQUIRED";
  else if (!oneOf(STUDY_LEVELS, input.level)) errors.level = "UNKNOWN_VALUE";
  checkCourseFields(errors, input.course_fields);

  const year = input.intake_year;
  if (year === undefined || year === null || year === "") errors.intake_year = "REQUIRED";
  else if (typeof year !== "number" || !Number.isInteger(year) || year < INTAKE_YEAR_MIN || year > INTAKE_YEAR_MAX) errors.intake_year = "INVALID";

  return errors;
}

/** The years offered on the Study plan screen: this year and the next two. */
export function intakeYears(now: Date): number[] {
  const year = now.getUTCFullYear();
  return [year, year + 1, year + 2];
}

export function relationshipOf(value: unknown): ProfileRelationship {
  return value === "parent" ? "parent" : "student";
}

/** The result rows as sent: trimmed, and a row the person left completely blank is dropped (a half-filled row stays, and is an error). */
export function cleanResults(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return (value as unknown[])
    .map((row) => ({ subject: text((row as { subject?: unknown } | null)?.subject), grade: text((row as { grade?: unknown } | null)?.grade) }))
    .filter((row) => row.subject !== "" || row.grade !== "");
}
