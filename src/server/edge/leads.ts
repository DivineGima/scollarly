import { errorResponse, isSameOrigin, jsonResponse, newRequestId, readJsonBody } from "@/lib/http";
import { createLead, type CreateLeadOutcome } from "@/modules/leads/service";
import { readSessionToken } from "@/server/auth/cookie";
import { isTrustedSession, sessionNeedsOnboarding } from "@/server/auth/trusted-session";
import { resolveSession } from "@/server/repositories/session-lookup";
import { getDb } from "@/server/db/runtime";
import { insertLead, tokenHasApplication } from "@/server/repositories/lead-intake";
import { createDurableObjectLimiter, limiterKey } from "@/server/security/rate-limit";
import { logError } from "@/server/log";
import { isMeasurementRequest } from "@/server/security/measurement";
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
/** Tries per minute per caller before the session lookup: it is a database query, so a flood of cookie-bearing posts must be stopped first. */
const GATE_LIMIT = 30;

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

  // Applying needs an account (PRD_3 F20, ADR-051): the server is the lock, whatever the page showed. The cookie is read first, which
  // costs nothing; only a request that has one pays for the one session query. The lead is then linked to that account (S8.2).
  const sessionToken = readSessionToken(request.headers);
  const measurement = isMeasurementRequest(request, env.PHASE0_PROBE_TOKEN);
  if (!measurement) {
    if (!sessionToken) return errorResponse(401, "UNAUTHENTICATED", "Sign in or create an account to continue.", requestId);
    const gate = await limiter(await limiterKey({ route: "leads-gate", ip: request.headers.get("cf-connecting-ip") }, env.RATE_LIMIT_SECRET), GATE_LIMIT, WINDOW_MS);
    if (!gate.allowed) {
      return errorResponse(429, "RATE_LIMITED", "Too many requests. Please wait a moment.", requestId, { headers: { "Retry-After": String(gate.retryAfterSeconds) } });
    }
    let session: Awaited<ReturnType<typeof resolveSession>>;
    try {
      session = await resolveSession(db, sessionToken);
    } catch (error) {
      logError(requestId, "leads", error);
      return errorResponse(503, "TEMPORARILY_UNAVAILABLE", "Please try again in a moment.", requestId);
    }
    if (!session || !isTrustedSession(session)) return errorResponse(401, "UNAUTHENTICATED", "Sign in or create an account to continue.", requestId);
    if (!session.accountConfirmed) return errorResponse(403, "ACCOUNT_NOT_CONFIRMED", "Finish creating your account to continue.", requestId);
    // A student applies after the questionnaire, never instead of it (PRD_3 F15, ADR-053).
    if (sessionNeedsOnboarding(session)) {
      return errorResponse(403, "ONBOARDING_REQUIRED", "Finish your sign-up to continue.", requestId);
    }
    // One application per account (PRD_4 F24, architecture 23.3): this older endpoint is no longer used by any screen, but a request queued by
    // an earlier version must not be able to make a second one. Only a student can have an application of their own to protect.
    if (session.role === "student") {
      try {
        if (await tokenHasApplication(db, sessionToken)) {
          return errorResponse(409, "ALREADY_APPLIED", "You already applied.", requestId);
        }
      } catch (error) {
        logError(requestId, "leads", error);
        return errorResponse(503, "TEMPORARILY_UNAVAILABLE", "Please try again in a moment.", requestId);
      }
    }
  }
  const outcome = await createLead(
    {
      insert: (row) => insertLead(db, row, sessionToken),
      verifyTurnstile: (token) => (measurement ? Promise.resolve("ok") : verifyTurnstile(env.TURNSTILE_SECRET_KEY, token)),
      limit: () => limiter(key, LIMIT, WINDOW_MS),
      slaSettings: () => cachedSlaSettings(db, env.DATABASE_URL),
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      onError: (error) => logError(requestId, "leads", error),
    },
    { idempotencyKey: request.headers.get("idempotency-key"), body: body.value, measurement },
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
