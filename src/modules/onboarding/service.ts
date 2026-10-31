import { canonicalJson, sha256Hex } from "@/lib/hash";
import { fieldErrors } from "@/lib/http";
import { normalisePhone } from "@/lib/phone";
import { generateRef } from "@/lib/ref";
import { idempotencyKeySchema, V } from "@/lib/schemas/common";
import { LEADS_PER_NUMBER_PER_DAY } from "@/modules/leads/service";
import { computeSla, type SlaSettings } from "@/modules/sla/service";
import type { NewOnboarding, OnboardingOutcome } from "@/server/repositories/onboarding";
import { onboardingBodySchema } from "./schema";

/**
 * `POST /api/v1/me/onboarding` (S13.3, architecture 21.6). The whole decision as a function of its dependencies, so every outcome is
 * tested without a runtime:
 *
 *  201 created   200 replayed (the same key again, or this account is already onboarded from another device)
 *  400 VALIDATION   403 FORBIDDEN (not a confirmed student-role account)   409 IDEMPOTENCY_KEY_REUSED
 *  429 RATE_LIMITED (five leads from one number in 24 hours)   503 TEMPORARILY_UNAVAILABLE (the phone retries)
 *
 * There is no Turnstile: the person is signed in with a confirmed account, and one account can onboard once.
 */

export interface CompleteOnboardingDeps {
  insert: (row: NewOnboarding) => Promise<OnboardingOutcome>;
  slaSettings: () => Promise<SlaSettings>;
  /** The server clock. The device clock is never trusted (ADR-009). */
  now: () => Date;
  newId: () => string;
  newRef?: () => string;
  onError?: (error: unknown) => void;
}

export type CompleteOnboardingOutcome =
  | { ok: true; status: 201 | 200; ref: string | null; replayed: boolean }
  | { ok: false; status: 400; code: "VALIDATION"; message: string; fields: Record<string, string> }
  | { ok: false; status: 403; code: "FORBIDDEN"; message: string }
  | { ok: false; status: 409; code: "IDEMPOTENCY_KEY_REUSED"; message: string }
  | { ok: false; status: 429; code: "RATE_LIMITED"; message: string; retryAfterSeconds: number; fields: Record<string, string> }
  | { ok: false; status: 503; code: "TEMPORARILY_UNAVAILABLE"; message: string };

const NUMBER_LIMIT_RETRY_SECONDS = 3600;

export async function completeOnboarding(
  deps: CompleteOnboardingDeps,
  input: { idempotencyKey: string | null; body: unknown },
): Promise<CompleteOnboardingOutcome> {
  const key = idempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) {
    return { ok: false, status: 400, code: "VALIDATION", message: "Idempotency-Key must be a UUID.", fields: { "Idempotency-Key": V.INVALID } };
  }

  const parsed = onboardingBodySchema.safeParse(input.body);
  if (!parsed.success) {
    return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error.issues) };
  }
  const body = parsed.data;

  // The schema already proved the number normalises for the contact's country, so this cannot fail; the guard keeps the types honest.
  const phone = normalisePhone(body.contact_whatsapp, body.contact_country);
  if (!phone.ok) return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields: { contact_whatsapp: V.PHONE_INVALID } };

  const payloadHash = await sha256Hex(canonicalJson(body));
  const receivedAt = deps.now();
  const results = body.results.map((r) => ({ subject: r.subject.trim(), grade: r.grade.trim() }));

  try {
    const sla = computeSla(receivedAt, await deps.slaSettings());
    const newRef = deps.newRef ?? generateRef;
    const outcome = await deps.insert({
      id: deps.newId(),
      idempotencyKey: key.data,
      payloadHash,
      refs: [body.client_ref, newRef(), newRef(), newRef()],
      clientRef: body.client_ref,
      name: body.applicant_name.trim(),
      whatsappE164: phone.value.e164,
      countryCode: body.applicant_country,
      qualificationType: body.qualification_type,
      results,
      // The lead of a parent holds the child's name and the parent's number; the parent's name is in `source` so the admin's WhatsApp
      // message can greet the parent (the `{contact_name}` placeholder).
      source: { page: "onboarding", relationship: body.relationship, contact_name: body.contact_name.trim(), course_fields: body.course_fields, level: body.level, intake_year: body.intake_year },
      locale: body.locale,
      consentNoticeVersion: body.consent.notice_version,
      consentAt: receivedAt,
      clientCreatedAt: new Date(body.client_created_at),
      receivedAt,
      slaDueAt: sla.dueAt,
      slaHoursApplied: sla.hoursApplied,
      numberLimit: LEADS_PER_NUMBER_PER_DAY,
      relationship: body.relationship,
      contactName: body.contact_name.trim(),
      level: body.level,
      courseFields: body.course_fields,
      intakeYear: body.intake_year,
    });

    switch (outcome.kind) {
      case "created":
        return { ok: true, status: 201, ref: outcome.ref, replayed: false };
      case "existing":
        return outcome.storedHash === payloadHash
          ? { ok: true, status: 200, ref: outcome.ref, replayed: true }
          : { ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED", message: "This request key was already used with different details." };
      case "already_onboarded":
        // Another device (or an earlier request with another key) finished this account's onboarding: carry on, nothing was written.
        return { ok: true, status: 200, ref: null, replayed: true };
      case "not_allowed":
        return { ok: false, status: 403, code: "FORBIDDEN", message: "Not allowed." };
      case "number_limited":
        return { ok: false, status: 429, code: "RATE_LIMITED", message: "This number has reached today's limit.", retryAfterSeconds: NUMBER_LIMIT_RETRY_SECONDS, fields: { reason: "number_limit" } };
      case "ref_exhausted":
        return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };
    }
  } catch (error) {
    deps.onError?.(error);
    return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };
  }
}
