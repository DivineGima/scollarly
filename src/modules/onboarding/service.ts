import { fieldErrors } from "@/lib/http";
import { normalisePhone } from "@/lib/phone";
import type { NewProfile, ProfileOutcome } from "@/server/repositories/onboarding";
import { onboardingBodySchema } from "./schema";

/**
 * `POST /api/v1/me/onboarding` (S13.3, changed in S15.2; architecture 21.6, 23.2). The whole decision as a function of its dependencies, so
 * every outcome is tested without a runtime. Finishing onboarding stores the profile and makes no lead (PRD_4 F24, FR-33):
 *
 *  201 created   200 replayed (this account is already onboarded: a retry, a double tap or a second device)
 *  400 VALIDATION   403 FORBIDDEN (not a confirmed student-role account)   503 TEMPORARILY_UNAVAILABLE (the phone retries)
 *
 * There is no Turnstile: the person is signed in with a confirmed account, and one account can onboard once. The `Idempotency-Key` header
 * of an earlier version is not needed any more: the account's one profile row is the replay guard.
 */

export interface CompleteOnboardingDeps {
  insert: (row: NewProfile) => Promise<ProfileOutcome>;
  /** The server clock. The device clock is never trusted (ADR-009). */
  now: () => Date;
  onError?: (error: unknown) => void;
}

export type CompleteOnboardingOutcome =
  | { ok: true; status: 201 | 200; replayed: boolean }
  | { ok: false; status: 400; code: "VALIDATION"; message: string; fields: Record<string, string> }
  | { ok: false; status: 403; code: "FORBIDDEN"; message: string }
  | { ok: false; status: 503; code: "TEMPORARILY_UNAVAILABLE"; message: string };

export async function completeOnboarding(deps: CompleteOnboardingDeps, input: { body: unknown }): Promise<CompleteOnboardingOutcome> {
  const parsed = onboardingBodySchema.safeParse(input.body);
  if (!parsed.success) {
    return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error.issues) };
  }
  const body = parsed.data;

  // The schema already proved the number normalises for the contact's country, so this cannot fail; the guard keeps the types honest.
  const phone = normalisePhone(body.contact_whatsapp, body.contact_country);
  if (!phone.ok) return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields: { contact_whatsapp: "PHONE_INVALID" } };

  try {
    const outcome = await deps.insert({
      name: body.applicant_name.trim(),
      whatsappE164: phone.value.e164,
      countryCode: body.applicant_country,
      qualificationType: body.qualification_type,
      results: body.results.map((r) => ({ subject: r.subject.trim(), grade: r.grade.trim() })),
      consentNoticeVersion: body.consent.notice_version,
      consentAt: deps.now(),
      relationship: body.relationship,
      contactName: body.contact_name.trim(),
      level: body.level,
      courseFields: body.course_fields,
      intakeYear: body.intake_year,
    });
    switch (outcome) {
      case "created":
        return { ok: true, status: 201, replayed: false };
      case "already_onboarded":
        // Another device (or an earlier request) finished this account's onboarding: carry on, nothing was written.
        return { ok: true, status: 200, replayed: true };
      case "not_allowed":
        return { ok: false, status: 403, code: "FORBIDDEN", message: "Not allowed." };
    }
  } catch (error) {
    deps.onError?.(error);
    return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };
  }
}
