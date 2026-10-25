import * as z from "zod";
import { canonicalJson, sha256Hex } from "@/lib/hash";
import type { Db } from "@/server/db/client";
import { insertStubLead } from "@/server/repositories/phase0-leads";
import type { LimitDecision } from "@/server/security/rate-limit";
import type { TurnstileResult } from "@/server/security/turnstile";

/**
 * S0.3 stub of `POST /api/v1/leads`: Zod, Turnstile verify, Durable Object limiter, one insert.
 * It exists so the lead POST CPU gate (at most 8 ms) can be measured. The real endpoint (S4.4) adds
 * phone normalisation, the per-number database limit, `received_at`/SLA and reference handling.
 */

const COUNTRIES = ["CM", "NG", "GH", "CI", "SN", "GN", "ZA"] as const; // the 7 student countries (PRD section 3)

export const stubLeadSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  whatsapp: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid WhatsApp number"),
  country_code: z.enum(COUNTRIES),
  turnstile_token: z.string().min(1).max(2048),
});

export type StubLeadInput = z.infer<typeof stubLeadSchema>;

export interface StubLeadDeps {
  db: Db;
  verifyTurnstile: (token: string) => Promise<TurnstileResult>;
  /** Returns the decision for this caller. The key is already a salted hash, never a raw IP. */
  limit: () => Promise<LimitDecision>;
  newId: () => string;
}

export type StubLeadOutcome =
  | { ok: true; status: 201 | 200; id: string; replayed: boolean }
  | { ok: false; status: 400; code: "VALIDATION"; message: string; fields: Record<string, string> }
  | { ok: false; status: 403; code: "TURNSTILE_FAILED"; message: string }
  | { ok: false; status: 409; code: "IDEMPOTENCY_KEY_REUSED"; message: string }
  | { ok: false; status: 429; code: "RATE_LIMITED"; message: string; retryAfterSeconds: number }
  | { ok: false; status: 503; code: "TEMPORARILY_UNAVAILABLE"; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createStubLead(
  deps: StubLeadDeps,
  input: { idempotencyKey: string | null; body: unknown },
): Promise<StubLeadOutcome> {
  if (!input.idempotencyKey || !UUID.test(input.idempotencyKey)) {
    return { ok: false, status: 400, code: "VALIDATION", message: "Idempotency-Key must be a UUID.", fields: { "Idempotency-Key": "Required UUID" } };
  }

  const parsed = stubLeadSchema.safeParse(input.body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "body"] = issue.message;
    return { ok: false, status: 400, code: "VALIDATION", message: "Check the highlighted fields.", fields };
  }

  const decision = await deps.limit();
  if (!decision.allowed) {
    return { ok: false, status: 429, code: "RATE_LIMITED", message: "Too many attempts. Try again in a minute.", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const turnstile = await deps.verifyTurnstile(parsed.data.turnstile_token);
  if (turnstile === "failed") return { ok: false, status: 403, code: "TURNSTILE_FAILED", message: "We could not confirm you are human." };
  if (turnstile === "unavailable") return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };

  // The Turnstile token is single-use and changes on every retry, so it is not part of the payload identity.
  const { turnstile_token: _token, ...payload } = parsed.data;
  const payloadHash = await sha256Hex(canonicalJson(payload));

  try {
    const result = await insertStubLead(deps.db, {
      id: deps.newId(),
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      name: payload.name,
      whatsappE164: payload.whatsapp.replace(/[^0-9+]/g, ""),
      countryCode: payload.country_code,
    });
    if (result.kind === "key_reused") {
      return { ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED", message: "This request key was already used with different details." };
    }
    return { ok: true, status: result.kind === "created" ? 201 : 200, id: result.id, replayed: result.kind === "replayed" };
  } catch {
    // The database may be asleep or failing. The client retries with backoff (architecture 10.1).
    return { ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." };
  }
}
