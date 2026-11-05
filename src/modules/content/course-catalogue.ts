import { isCourseField } from "@/lib/courses";
import type { ProgrammeChoice } from "@/modules/applications/programmes";
import type { CatalogueEntry } from "@/modules/student/ordering";
import { readCatalogue } from "./read";
import type { CatalogueSnapshot } from "./types";

/**
 * The public course catalogue (architecture 21.7): for every published university, what the phone needs to order the list for one
 * person: slug, name, city, NAAC grade and the course fields it offers. It holds no personal data and is the same for everyone, so it is
 * safe to embed in a cached page (the landing page's course finder, `/me/universities`, `/offline`).
 */
export function toCourseCatalogue(snapshot: CatalogueSnapshot): CatalogueEntry[] {
  return snapshot.universities.map((university) => ({
    slug: university.slug,
    name: university.name,
    city: university.city,
    naacGrade: university.naacGrade,
    fields: [...new Set(university.programmes.map((programme) => programme.field).filter((field): field is string => isCourseField(field)))],
  }));
}

export async function readCourseCatalogue(): Promise<CatalogueEntry[]> {
  return toCourseCatalogue(await readCatalogue());
}

/** Every published programme with its university, for the Apply screen's list (S15.3). Public data, the same for everyone. */
export function toProgrammeChoices(snapshot: CatalogueSnapshot): ProgrammeChoice[] {
  return snapshot.universities.flatMap((university) =>
    university.programmes.map((programme) => ({
      id: programme.id,
      name: programme.name,
      universityName: university.name,
      field: programme.field,
      level: programme.level,
      naacGrade: university.naacGrade,
    })),
  );
}

export async function readProgrammeChoices(): Promise<ProgrammeChoice[]> {
  return toProgrammeChoices(await readCatalogue());
}
