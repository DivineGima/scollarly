"use client";

import { useTranslations } from "next-intl";
import { COURSE_FIELDS } from "@/lib/courses";
import type { UniversityListLabels } from "./university-list";

/** The words of the university list in the student's language, and the names of the course fields, from the `student` and `courses` messages. */
export function useUniversityLabels(): { labels: UniversityListLabels; courseNames: Record<string, string> } {
  const t = useTranslations("student.universities");
  const courses = useTranslations("courses");
  return {
    labels: { naac: t.raw("naac") as string, naacMissing: t("naacMissing"), offers: t.raw("offers") as string, open: t.raw("open") as string },
    courseNames: Object.fromEntries(COURSE_FIELDS.map((field) => [field, courses(field)])),
  };
}
