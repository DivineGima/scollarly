import { canonicalJson, sha256Hex } from "@/lib/hash";
import { fieldErrors } from "@/lib/http";
import { generateRef } from "@/lib/ref";
import { idempotencyKeySchema, V } from "@/lib/schemas/common";
import { LEADS_PER_NUMBER_PER_DAY } from "@/modules/leads/service";
import { computeSla, type SlaSettings } from "@/modules/sla/service";
import type { ApplicationOutcome, NewApplication } from "@/server/repositories/applications";
import { applicationBodySchema } from "./schema";

/**
 * `POST /api/v1/me/application` (S15.3, PRD_4 F24, FR-34; architecture 23.3). The whole decision as a function of its dependencies, so every
 * outcome is tested without a runtime. An application is made from the account's profile: the body names only the programmes.
 *
 *  201 created   200 replayed (the same key again for the same person)
 *  400 VALIDATION (fewer than three different programmes, an unknown programme)
 *  403 ONBOARDING_REQUIRED (no profile)   403 FORBIDDEN (not a confirmed student-role account)
 *  409 ALREADY_APPLIED (this account has an application; the body carries its reference)   409 IDEMPOTENCY_KEY_REUSED
 *  429 RATE_LIMITED (five leads from one number in 24 hours)   503 TEMPORARILY_UNAVAILABLE (the phone retries)
 *
 * There is no Turnstile: the person is signed in with a confirmed account and one account applies once.
 */

export interface ApplyDeps {
  insert: (row: NewApplication) => Promise<ApplicationOutcome>;
  slaSettings: () => Promise<SlaSettings>;
  /** The server clock. The device clock is never trusted (ADR-009). */
  now: () => Date;
  newId: () => string;
  newRef?: () => string;
  onError?: (error: unknown) => void;
}

export type ApplyOutcome =
  | { ok: true; status: 201 | 200; ref: string; replayed: boolean }
  | { ok: false; status: 400; code: "VALIDATION"; message: string; fields: Record<string, string> }
  | { ok: false; status: 403; code: "ONBOARDING_REQUIRED" | "FORBIDDEN"; message: string }
  | { ok: false; status: 409; code: "ALREADY_APPLIED"; message: string; ref: string }
  | { ok: false; status: 409; code: "IDEMPOTENCY_KEY_REUSED"; message: string }
  | { ok: false; status: 429; code: "RATE_LIMITED"; message: string; retryAfterSeconds: number; fields: Record<string, string> }
  | { ok: false; status: 503; code: "TEMPORARILY_UNAVAILABLE"; message: string };

const NUMBER_LIMIT_RETRY_SECONDS = 3600;

export async function applyFromProfile(deps: ApplyDeps, input: { idempotencyKey: string | null; body: unknown }): Promise<ApplyOutcome> {
  const key = idempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) {
    return { ok: false, status: 400, code: "VALIDATION", message: "Idempotency-Key must be a UUID.", fields: { "Idempotency-Key": V.INVALID } };
  }

  const parsed = applicationBodySchema.safeParse(input.body);
  if (!parsed.success) {
    return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error.issues) };
  }
  const body = parsed.data;

  const payloadHash = await sha256Hex(canonicalJson(body));
  const receivedAt = deps.now();

  try {
    const sla = computeSla(receivedAt, await deps.slaSettings());
    const newRef = deps.newRef ?? generateRef;
    const outcome = await deps.insert({
      id: deps.newId(),
      idempotencyKey: key.data,
      payloadHash,
      refs: [body.client_ref, newRef(), newRef(), newRef()],
      clientRef: body.client_ref,
      locale: body.locale,
      clientCreatedAt: new Date(body.client_created_at),
      receivedAt,
      slaDueAt: sla.dueAt,
      slaHoursApplied: sla.hoursApplied,
      programmeIds: body.programme_ids,
      numberLimit: LEADS_PER_NUMBER_PER_DAY,
    });

    switch (outcome.kind) {
      case "created":
        return { ok: true, status: 201, ref: outcome.ref, replayed: false };
      case "existing":
        return outcome.storedHash === payloadHash
          ? { ok: true, status: 200, ref: outcome.ref, replayed: true }
          : { ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED", message: "This request key was already used with different details." };
      case "already_applied":
        return { ok: false, status: 409, code: "ALREADY_APPLIED", message: "You already applied.", ref: outcome.ref };
      case "profile_required":
        return { ok: false, status: 403, code: "ONBOARDING_REQUIRED", message: "Finish your sign-up to continue." };
      case "not_allowed":
        return { ok: false, status: 403, code: "FORBIDDEN", message: "Not allowed." };
      case "number_limited":
        return {
          ok: false,
          status: 429,
          code: "RATE_LIMITED",
          message: "This number has reached today's limit.",
          retryAfterSeconds: NUMBER_LIMIT_RETRY_SECONDS,
          fields: { reason: "number_limit" },
        };
      case "unknown_programme":
        return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields: { programme_ids: V.UNKNOWN_VALUE } };
      case "ref_exhausted":
        return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };
    }
  } catch (error) {
    deps.onError?.(error);
    // The database may be asleep or failing. The phone retries with backoff (architecture 10.1).
    return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };
  }
}
