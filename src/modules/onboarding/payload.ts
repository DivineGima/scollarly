import type { ProfileRelationship } from "@/lib/constants";
import { type CourseField, isCourseField } from "@/lib/courses";
import { CONSENT_NOTICE_VERSION } from "@/lib/lead-form";
import { generateRef } from "@/lib/ref";
import { effectiveAnswers } from "./questions";

/**
 * The draft the questionnaire keeps on the phone (architecture 21.6) and the request body it becomes. Plain TypeScript with no Zod,
 * so the screens stay small; the server validates the body with the same rules (`schema.ts`).
 */

export interface OnboardingValues {
  relationship: ProfileRelationship;
  applicant_name: string;
  applicant_country: string;
  contact_name: string;
  contact_country: string;
  contact_whatsapp: string;
  qualification_type: string;
  results: { subject: string; grade: string }[];
  level: string;
  course_fields: string[];
  intake_year: number | null;
  consent: boolean;
}

export function emptyValues(relationship: ProfileRelationship, course: CourseField | null = null): OnboardingValues {
  return {
    relationship,
    applicant_name: "",
    applicant_country: "",
    contact_name: "",
    contact_country: "",
    contact_whatsapp: "",
    qualification_type: "",
    results: [],
    level: "",
    // A course picked on the landing page is already ticked on the Study plan screen (F13).
    course_fields: course ? [course] : [],
    intake_year: null,
    consent: false,
  };
}

/** The `course` of `?course=`, or null for anything that is not on the list. */
export function courseFromSearch(search: string): CourseField | null {
  const value = new URLSearchParams(search).get("course");
  return isCourseField(value) ? value : null;
}

export interface PayloadContext {
  locale: string;
  now?: Date;
  ref?: string;
}

/** The body of `POST /api/v1/me/onboarding`. The idempotency key travels in the header, as for every lead. */
export function buildOnboardingPayload(values: OnboardingValues, context: PayloadContext) {
  const answers = effectiveAnswers(values);
  return {
    relationship: values.relationship,
    applicant_name: String(answers.applicant_name ?? "").trim(),
    applicant_country: String(answers.applicant_country ?? ""),
    contact_name: String(answers.contact_name ?? "").trim(),
    contact_country: String(answers.contact_country ?? ""),
    contact_whatsapp: values.contact_whatsapp.trim(),
    qualification_type: values.qualification_type,
    results: answers.results as { subject: string; grade: string }[],
    level: values.level,
    course_fields: values.course_fields,
    intake_year: values.intake_year,
    locale: context.locale,
    client_ref: context.ref ?? generateRef(),
    client_created_at: (context.now ?? new Date()).toISOString(),
    consent: { notice_version: CONSENT_NOTICE_VERSION },
  };
}

export type OnboardingPayload = ReturnType<typeof buildOnboardingPayload>;
