import { canonicalJson, sha256Hex } from "@/lib/hash";
import { fieldErrors } from "@/lib/http";
import { normalisePhone } from "@/lib/phone";
import { generateRef } from "@/lib/ref";
import { idempotencyKeySchema, V } from "@/lib/schemas/common";
import { leadIntakeSchema } from "@/lib/schemas/lead";
import { computeSla, type SlaSettings } from "@/modules/sla/service";
import type { InsertLeadOutcome, NewLead } from "@/server/repositories/leads";
import type { LimitDecision } from "@/server/security/rate-limit";
import type { TurnstileResult } from "@/server/security/turnstile";

/**
 * `POST /api/v1/leads` (S4.4, architecture 8.2, 10.1). The whole decision, as a function of its dependencies, so every
 * documented outcome is tested without a runtime. The order is cheapest first: header and body shape, the rate limiter,
 * Turnstile, then one database call.
 *
 *  201 created   200 replayed   400 VALIDATION   403 TURNSTILE_FAILED   409 IDEMPOTENCY_KEY_REUSED
 *  429 RATE_LIMITED (limiter, or five leads from one number in 24 hours)   503 TEMPORARILY_UNAVAILABLE (the client retries)
 */

/** Leads allowed from one WhatsApp number in 24 hours (architecture 10.1). */
export const LEADS_PER_NUMBER_PER_DAY = 5;

export interface CreateLeadDeps {
  /** Stores the lead through the repository. */
  insert: (row: NewLead) => Promise<InsertLeadOutcome>;
  verifyTurnstile: (token: string) => Promise<TurnstileResult>;
  /** The rate limiter's decision for this caller. The key is already a salted hash, never a raw IP. */
  limit: () => Promise<LimitDecision>;
  /** The SLA hours from `site_setting` (cached for a short time by the caller). */
  slaSettings: () => Promise<SlaSettings>;
  /** The server clock. The device clock is never trusted (ADR-009). */
  now: () => Date;
  newId: () => string;
  /** A random server reference, used only when the device's own reference is already taken. */
  newRef?: () => string;
  /** Told about the fault behind a 503, so the caller can log it (the outcome itself carries no detail). */
  onError?: (error: unknown) => void;
}

export type CreateLeadOutcome =
  | { ok: true; status: 201 | 200; ref: string; replayed: boolean }
  | { ok: false; status: 400; code: "VALIDATION"; message: string; fields: Record<string, string> }
  | { ok: false; status: 403; code: "TURNSTILE_FAILED"; message: string }
  | { ok: false; status: 409; code: "IDEMPOTENCY_KEY_REUSED"; message: string }
  | { ok: false; status: 429; code: "RATE_LIMITED"; message: string; retryAfterSeconds: number; fields?: Record<string, string> }
  | { ok: false; status: 503; code: "TEMPORARILY_UNAVAILABLE"; message: string };

const NUMBER_LIMIT_RETRY_SECONDS = 3600;

export async function createLead(
  deps: CreateLeadDeps,
  input: { idempotencyKey: string | null; body: unknown; /** Set by the edge handler only, for a request that proved it is the CPU measurement (security/measurement.ts). */ measurement?: boolean },
): Promise<CreateLeadOutcome> {
  const key = idempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) {
    return { ok: false, status: 400, code: "VALIDATION", message: "Idempotency-Key must be a UUID.", fields: { "Idempotency-Key": V.INVALID } };
  }

  const parsed = leadIntakeSchema.safeParse(input.body);
  if (!parsed.success) {
    return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error.issues) };
  }

  const decision = await deps.limit();
  if (!decision.allowed) {
    return { ok: false, status: 429, code: "RATE_LIMITED", message: "Too many attempts. Try again in a minute.", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const { turnstile_token: token, ...payload } = parsed.data;
  const turnstile = await deps.verifyTurnstile(token);
  if (turnstile === "failed") return { ok: false, status: 403, code: "TURNSTILE_FAILED", message: "We could not confirm you are human." };
  if (turnstile === "unavailable") return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };

  // The schema already proved the number normalises for this country (checkPhone), so this cannot fail; the guard keeps the types honest.
  const phone = normalisePhone(payload.whatsapp, payload.country_code);
  if (!phone.ok) return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields: { whatsapp: V.PHONE_INVALID } };

  // The Turnstile token is single use and changes on every retry, so it is not part of the payload's identity.
  const payloadHash = await sha256Hex(canonicalJson(payload));
  const receivedAt = deps.now();

  try {
    const sla = computeSla(receivedAt, await deps.slaSettings());
    const newRef = deps.newRef ?? generateRef;
    const outcome = await deps.insert({
      id: deps.newId(),
      idempotencyKey: key.data,
      payloadHash,
      refs: [payload.client_ref, newRef(), newRef(), newRef()],
      clientRef: payload.client_ref,
      name: payload.name,
      whatsappE164: phone.value.e164,
      countryCode: payload.country_code,
      email: payload.email ?? null,
      intakeKind: payload.intake_kind,
      qualificationType: payload.intake_kind === "full" ? payload.qualification_type : null,
      results: payload.intake_kind === "full" ? payload.results : [],
      source: input.measurement ? { ...payload.source, measurement: true } : payload.source,
      locale: payload.locale,
      consentNoticeVersion: payload.consent.notice_version,
      consentAt: receivedAt,
      clientCreatedAt: new Date(payload.client_created_at),
      receivedAt,
      slaDueAt: sla.dueAt,
      slaHoursApplied: sla.hoursApplied,
      programmeIds: payload.programme_ids,
      numberLimit: LEADS_PER_NUMBER_PER_DAY,
    });

    switch (outcome.kind) {
      case "created":
        return { ok: true, status: 201, ref: outcome.ref, replayed: false };
      case "existing":
        return outcome.storedHash === payloadHash
          ? { ok: true, status: 200, ref: outcome.ref, replayed: true }
          : { ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED", message: "This request key was already used with different details." };
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
    // The database may be asleep or failing. The client retries with backoff (architecture 10.1).
    return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };
  }
}
