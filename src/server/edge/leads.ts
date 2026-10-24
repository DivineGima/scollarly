import { errorResponse, isSameOrigin, jsonResponse, newRequestId, readJsonBody } from "@/lib/http";
import { createLead, type CreateLeadOutcome } from "@/modules/leads/service";
import { getDb } from "@/server/db/runtime";
import { insertLead } from "@/server/repositories/leads";
import { createDurableObjectLimiter, limiterKey } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";
import { cachedSlaSettings } from "./settings-cache";

/**
 * `POST /api/v1/leads` as a plain function of `(request, env)` (S4.4). The Worker entry calls it directly, so the request
 * never pays for the Next.js server layer (Stage 0 measured 12 ms through Next.js against an 8 ms gate); the Next.js route
 * file calls the same function, so there is one implementation. The decision itself is `modules/leads/service.ts`.
 *
 * CPU: a 14 ms tail was measured on the Stage 0 stub; this handler adds the full schema, the phone check and a hash, and
 * must be measured again on the deployed Worker (tracker, Stage 4 CPU row).
 */

/** A full application with 30 result rows and 20 programmes is about 4 KB; 16 KB leaves room for long names. */
const MAX_BODY_BYTES = 16 * 1024;
const LIMIT = 5; // requests per window per caller
const WINDOW_MS = 60_000;

export const LEADS_PATH = "/api/v1/leads";

export async function handleLeadPost(request: Request, env: CloudflareEnv): Promise<Response> {
  const requestId = newRequestId();
  if (!isSameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-origin requests are not allowed.", requestId);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? errorResponse(413, "PAYLOAD_TOO_LARGE", "Request is too large.", requestId)
      : errorResponse(400, "VALIDATION", "Request body must be valid JSON.", requestId);
  }

  const db = getDb(env);
  const limiter = createDurableObjectLimiter(env.RATE_LIMITER);
  const key = await limiterKey({ route: "leads", ip: request.headers.get("cf-connecting-ip") }, env.RATE_LIMIT_SECRET);

  const outcome = await createLead(
    {
      insert: (row) => insertLead(db, row),
      verifyTurnstile: (token) => verifyTurnstile(env.TURNSTILE_SECRET_KEY, token),
      limit: () => limiter(key, LIMIT, WINDOW_MS),
      slaSettings: () => cachedSlaSettings(db, env.DATABASE_URL),
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    },
    { idempotencyKey: request.headers.get("idempotency-key"), body: body.value },
  );
  return toResponse(outcome, requestId);
}

export function toResponse(outcome: CreateLeadOutcome, requestId: string): Response {
  if (outcome.ok) {
    return jsonResponse({ status: outcome.replayed ? "replayed" : "created", ref: outcome.ref }, outcome.status);
  }
  switch (outcome.status) {
    case 400:
      return errorResponse(400, outcome.code, outcome.message, requestId, { fields: outcome.fields });
    case 429:
      return errorResponse(429, outcome.code, outcome.message, requestId, {
        headers: { "Retry-After": String(outcome.retryAfterSeconds) },
        ...(outcome.fields ? { fields: outcome.fields } : {}),
      });
    default:
      return errorResponse(outcome.status, outcome.code, outcome.message, requestId);
  }
}
