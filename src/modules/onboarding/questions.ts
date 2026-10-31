import type { ProfileRelationship } from "@/lib/constants";
import { type AnswerErrors, type AnswerField, type AnswerInput, cleanResults, validateAnswers } from "./validate";

/**
 * The questions as data (architecture 21.6): which screens a student sees and which a parent sees, and which answers each screen
 * owns. One screen per question group, in order. No budget, city or scholarship question (owner decision D6). The words are
 * translation keys `onboarding.<step>.*`; this file holds no text.
 *
 *   Student: Basics, School results, Study plan, then the consent.
 *   Parent:  Who is applying (the child), School results, Study plan (all about the child), Your contact, then the consent.
 */

export type StepKey = "basics" | "who" | "results" | "plan" | "contact" | "consent";

export const STEPS_FOR: Record<ProfileRelationship, readonly StepKey[]> = {
  student: ["basics", "results", "plan", "consent"],
  parent: ["who", "results", "plan", "contact", "consent"],
};

/** The answers a screen owns. "Next" is blocked only by the errors of these fields. */
export const STEP_FIELDS: Record<StepKey, readonly (AnswerField | "consent")[]> = {
  basics: ["applicant_name", "applicant_country", "contact_whatsapp"],
  who: ["applicant_name", "applicant_country"],
  results: ["qualification_type", "results"],
  plan: ["level", "course_fields", "intake_year"],
  contact: ["contact_name", "contact_country", "contact_whatsapp"],
  consent: ["consent"],
};

export interface StepInput extends AnswerInput {
  consent?: unknown;
}

/** The errors that belong to one screen, so a person is never told about a screen they have not reached. */
export function validateStep(step: StepKey, input: StepInput): AnswerErrors {
  const all: AnswerErrors = validateAnswers(effectiveAnswers(input));
  if (input.consent !== true) all.consent = "CONSENT_REQUIRED";
  const own: AnswerErrors = {};
  for (const field of STEP_FIELDS[step]) {
    const error = all[field];
    if (error) own[field] = error;
  }
  return own;
}

/** For a student the contact is the applicant (see `validate.ts`); the screens fill the applicant only, so mirror it here. */
export function effectiveAnswers(input: StepInput): AnswerInput {
  const answers = { ...input, results: cleanResults(input.results) };
  if (input.relationship === "parent") return answers;
  return { ...answers, contact_name: input.applicant_name, contact_country: input.applicant_country };
}

/** The first screen with an error, or null when every screen is complete: where "Finish" sends a person who skipped something. */
export function firstIncompleteStep(relationship: ProfileRelationship, input: StepInput): StepKey | null {
  for (const step of STEPS_FOR[relationship]) {
    if (Object.keys(validateStep(step, input)).length > 0) return step;
  }
  return null;
}

/** 1-based position and total, for the progress bar. */
export function progressOf(relationship: ProfileRelationship, step: StepKey): { position: number; total: number } {
  const steps = STEPS_FOR[relationship];
  return { position: Math.max(steps.indexOf(step), 0) + 1, total: steps.length };
}
