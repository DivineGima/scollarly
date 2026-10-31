import { isCourseField, type CourseField } from "@/lib/courses";

/**
 * Which university to show first (architecture 21.7, ADR-044; owner decision D8), as a pure function so it is tested without a browser
 * and runs on the phone:
 *
 *  1. universities that offer any of the chosen course fields come first;
 *  2. then by NAAC grade, best first (A++, A+, A, B++, B+, B, then any other grade); a grade that is not stated comes last;
 *  3. then by name, A to Z.
 *
 * Universities that offer none of the chosen fields follow, in the same order. With no chosen field (someone who has not finished
 * onboarding) nothing matches, so the order is the NAAC grade and then the name. No personal data is involved: the catalogue is the same
 * for everyone, and the person's answers are applied here, in the browser.
 */

export interface CatalogueEntry {
  slug: string;
  name: string;
  city: string | null;
  /** As entered by the owner, for example `A++`; null when no grade is stated. */
  naacGrade: string | null;
  /** The distinct course fields of its published programmes. */
  fields: readonly string[];
}

export interface OrderedUniversity extends CatalogueEntry {
  /** The chosen fields this university offers, in the order the person chose them. Empty when none. */
  matches: CourseField[];
}

/** Best first. A grade that is not on this list but is stated sorts after these and before "not stated". */
const GRADE_RANK: Readonly<Record<string, number>> = { "A++": 0, "A+": 1, A: 2, "B++": 3, "B+": 4, B: 5 };
const OTHER_GRADE_RANK = 6;
const NOT_STATED_RANK = 7;

export function gradeRank(grade: string | null): number {
  const value = (grade ?? "").trim().toUpperCase();
  if (value === "") return NOT_STATED_RANK;
  return GRADE_RANK[value] ?? OTHER_GRADE_RANK;
}

export function orderUniversities(catalogue: readonly CatalogueEntry[], chosenFields: readonly string[]): OrderedUniversity[] {
  const chosen = chosenFields.filter(isCourseField);
  const rows = catalogue.map((entry): OrderedUniversity => ({ ...entry, matches: chosen.filter((field) => entry.fields.includes(field)) }));
  return rows.sort((a, b) => {
    const matched = Number(b.matches.length > 0) - Number(a.matches.length > 0);
    if (matched !== 0) return matched;
    const grade = gradeRank(a.naacGrade) - gradeRank(b.naacGrade);
    if (grade !== 0) return grade;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}
