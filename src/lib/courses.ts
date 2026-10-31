import type { StudyLevel } from "./constants";

/**
 * The course list (architecture 21.7, ADR-044). A code constant, not a table. Each programme's existing `field` column holds one
 * of these codes and `level` holds a study level; the questionnaire, the course finder and the ordering of universities read them.
 * The categories were approved by the owner on 2026-10-31 (tracker R2); the display names are translation keys `courses.<code>`.
 */
export const COURSE_FIELDS = [
  "computer_science_it",
  "mechanical_engineering",
  "civil_engineering",
  "electrical_electronics_engineering",
  "electronics_communication_engineering",
  "engineering_postgraduate",
  "business_management",
  "commerce",
  "pharmacy",
  "health_nursing",
  "science_arts",
  "law",
] as const;
export type CourseField = (typeof COURSE_FIELDS)[number];

export function isCourseField(value: unknown): value is CourseField {
  return typeof value === "string" && (COURSE_FIELDS as readonly string[]).includes(value);
}

/** First match wins, so the specific rules (a computer science degree, nursing) come before the general science and arts rule. */
const FIELD_RULES: readonly { test: RegExp; field: CourseField }[] = [
  { test: /computer science|^BCA\b|^MCA\b/i, field: "computer_science_it" },
  { test: /nursing/i, field: "health_nursing" },
  { test: /pharm/i, field: "pharmacy" },
  { test: /^M\.Tech\b/i, field: "engineering_postgraduate" },
  { test: /mechanical/i, field: "mechanical_engineering" },
  { test: /civil/i, field: "civil_engineering" },
  { test: /electronics\s*&\s*communication/i, field: "electronics_communication_engineering" },
  { test: /electrical|electronics/i, field: "electrical_electronics_engineering" },
  { test: /^BBA\b|^MBA\b/i, field: "business_management" },
  { test: /^[BM]\.Com\b/i, field: "commerce" },
  { test: /^LLB\b/i, field: "law" },
  { test: /^(B\.Sc|M\.Sc|B\.A\.|B\.Ed)/i, field: "science_arts" },
];

/** Postgraduate names start with `M.` or are `MBA` / `MCA`; everything else on the list is a bachelor's degree or LLB. */
const POSTGRADUATE = /^(M\.|MBA\b|MCA\b)/i;

/**
 * The course field and study level of a programme, from its name. Null for a name no rule recognises, so a new programme that
 * needs a decision is noticed (the seed and the unit test both fail on it) instead of being filed silently.
 */
export function courseOf(programmeName: string): { field: CourseField; level: StudyLevel } | null {
  const name = programmeName.trim();
  const rule = FIELD_RULES.find((r) => r.test.test(name));
  if (!rule) return null;
  return { field: rule.field, level: POSTGRADUATE.test(name) ? "postgraduate" : "undergraduate" };
}
