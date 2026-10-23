import { createStubLead, type StubLeadOutcome } from "@/modules/leads/stub-intake";
import { errorResponse, isSameOrigin, jsonResponse, newRequestId, readJsonBody } from "@/lib/http";
import { createHttpDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { createDurableObjectLimiter, limiterKey } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";

const MAX_BODY_BYTES = 8 * 1024;
const LIMIT = 5; // requests per window per caller
const WINDOW_MS = 60_000;

/** S0.3 stub of `POST /api/v1/leads`. The real endpoint is built in S4.4. */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  if (!isSameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-origin requests are not allowed.", requestId);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? errorResponse(413, "PAYLOAD_TOO_LARGE", "Request is too large.", requestId)
      : errorResponse(400, "VALIDATION", "Request body must be valid JSON.", requestId);
  }

  const env = getEnv();
  const limiter = createDurableObjectLimiter(env.RATE_LIMITER);
  const key = await limiterKey({ route: "leads", ip: request.headers.get("cf-connecting-ip") }, env.BETTER_AUTH_SECRET);

  const outcome = await createStubLead(
    {
      db: createHttpDb(env.DATABASE_URL),
      verifyTurnstile: (token) => verifyTurnstile(env.TURNSTILE_SECRET_KEY, token),
      limit: () => limiter(key, LIMIT, WINDOW_MS),
      newId: () => crypto.randomUUID(),
    },
    { idempotencyKey: request.headers.get("idempotency-key"), body: body.value },
  );
  return toResponse(outcome, requestId);
}

function toResponse(outcome: StubLeadOutcome, requestId: string): Response {
  if (outcome.ok) {
    return jsonResponse({ status: outcome.replayed ? "replayed" : "created", ref: outcome.id }, outcome.status);
  }
  switch (outcome.status) {
    case 400:
      return errorResponse(400, outcome.code, outcome.message, requestId, { fields: outcome.fields });
    case 429:
      return errorResponse(429, outcome.code, outcome.message, requestId, { headers: { "Retry-After": String(outcome.retryAfterSeconds) } });
    default:
      return errorResponse(outcome.status, outcome.code, outcome.message, requestId);
  }
}
