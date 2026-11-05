import { isCourseField } from "@/lib/courses";
import { gradeRank } from "@/modules/student/ordering";

/**
 * The programmes the Apply screen offers (PRD_4 F24, architecture 23.3). The list is the public catalogue, the same for everyone, so it can
 * sit in a cached page; the person's own course fields are applied here, in the browser, and nothing personal is in the page.
 */

/** A full application needs three different programmes (ADR-030), the same rule as the older form. Kept here, not in the Zod schema, so the phone does not load Zod. */
export const MIN_PROGRAMMES = 3;
export const MAX_PROGRAMMES = 20;

export interface ProgrammeChoice {
  id: string;
  name: string;
  universityName: string;
  /** The course field of the programme (`lib/courses`), or null when it has none. */
  field: string | null;
  level: string | null;
  /** The university's NAAC grade as entered by the owner; null when none is stated. */
  naacGrade: string | null;
}

export interface OrderedProgramme extends ProgrammeChoice {
  /** True when the programme is in one of the person's chosen course fields: shown first and marked "Suggested". */
  suggested: boolean;
}

/**
 * Suggested programmes first (a programme in one of the chosen course fields), then by the university's NAAC grade, best first, then by
 * university and programme name. The same idea as the Universities list (architecture 21.7), so the two screens agree.
 */
export function orderProgrammes(choices: readonly ProgrammeChoice[], courseFields: readonly string[]): OrderedProgramme[] {
  const chosen = new Set<string>(courseFields.filter(isCourseField));
  return choices
    .map((choice): OrderedProgramme => ({ ...choice, suggested: choice.field !== null && chosen.has(choice.field) }))
    .sort((a, b) => {
      const suggested = Number(b.suggested) - Number(a.suggested);
      if (suggested !== 0) return suggested;
      const grade = gradeRank(a.naacGrade) - gradeRank(b.naacGrade);
      if (grade !== 0) return grade;
      const university = a.universityName.localeCompare(b.universityName, "en", { sensitivity: "base" });
      return university !== 0 ? university : a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    });
}
