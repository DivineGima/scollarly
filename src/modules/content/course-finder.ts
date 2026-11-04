import { isCourseField } from "@/lib/courses";
import { orderUniversities, type CatalogueEntry, type OrderedUniversity } from "@/modules/student/ordering";

/**
 * The landing page's course finder (architecture 21.12, F13), as pure functions so they are tested without a browser. It reads the public
 * catalogue that is already embedded in the page and holds no personal data.
 */

/**
 * The universities that offer one course, best NAAC grade first and then A to Z (the same order the student app uses). An unknown or empty
 * value gives an empty list rather than every university, so a tampered or stale choice never shows a misleading answer.
 */
export function findUniversitiesByCourse(catalogue: readonly CatalogueEntry[], field: string): OrderedUniversity[] {
  if (!isCourseField(field)) return [];
  return orderUniversities(catalogue, [field]).filter((university) => university.matches.length > 0);
}

/** Where "Create your free account" goes: the sign-up page with the course carried in the query string. */
export function signUpHrefForCourse(field: string): string {
  return isCourseField(field) ? `/sign-up?course=${field}` : "/sign-up";
}
