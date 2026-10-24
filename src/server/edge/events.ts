import { errorResponseFor, isSameOrigin, newRequestId, readJsonBody, validationErrorResponse } from "@/lib/http";
import { eventsBodySchema } from "@/modules/events/schema";
import { planEvents } from "@/modules/events/service";
import { getDb } from "@/server/db/runtime";
import { recordWaTaps } from "@/server/repositories/events";
import { createDurableObjectLimiter, limiterKey } from "@/server/security/rate-limit";
import { pageViewsEnabled } from "./settings-cache";

/**
 * `POST /api/v1/events` (S4.5, architecture 8.2, 10.3), a plain function in the Worker entry like the lead POST. It accepts a
 * batch of up to 50 events and answers 202. Taps with a lead reference go to Neon (capped per reference per day in the
 * database); every other event is only a count in the collector Durable Object. The country is read from the edge request and
 * any country the client sends is not even a field. Raw IP addresses are never stored: the limiter key is a daily-salted hash.
 */

export const EVENTS_PATH = "/api/v1/events";
const MAX_BODY_BYTES = 16 * 1024;
/** A browser flushes a few times a session; this stops a script from flooding the collector. */
const LIMIT = 30;
const WINDOW_MS = 60_000;

interface CollectorStub {
  addCounts(counts: Record<string, number>): Promise<void>;
}

export async function handleEventsPost(request: Request, env: CloudflareEnv): Promise<Response> {
  const requestId = newRequestId();
  if (!isSameOrigin(request)) return errorResponseFor("FORBIDDEN", "Cross-origin requests are not allowed.", requestId);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? errorResponseFor("PAYLOAD_TOO_LARGE", "Request is too large.", requestId)
      : errorResponseFor("VALIDATION", "Request body must be valid JSON.", requestId);
  }

  const parsed = eventsBodySchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(parsed.error.issues, requestId);

  const key = await limiterKey({ route: "events", ip: request.headers.get("cf-connecting-ip") }, env.RATE_LIMIT_SECRET);
  const decision = await createDurableObjectLimiter(env.RATE_LIMITER)(key, LIMIT, WINDOW_MS);
  if (!decision.allowed) {
    return errorResponseFor("RATE_LIMITED", "Too many requests.", requestId, { headers: { "Retry-After": String(decision.retryAfterSeconds) } });
  }

  try {
    const db = getDb(env);
    const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
    const plan = planEvents(parsed.data.events, { country, now: new Date(), collectPageViews: await pageViewsEnabled(db, env.DATABASE_URL) });

    const work: Promise<unknown>[] = [];
    if (plan.taps.length > 0) work.push(recordWaTaps(db, plan.taps));
    if (Object.keys(plan.counts).length > 0) {
      const collector = env.COLLECTOR.get(env.COLLECTOR.idFromName("global")) as unknown as CollectorStub;
      work.push(collector.addCounts(plan.counts));
    }
    await Promise.all(work);
    return new Response(JSON.stringify({ accepted: parsed.data.events.length }), {
      status: 202,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    // Events are not worth an error page: the client keeps them and sends them again at the next flush.
    return errorResponseFor("TEMPORARILY_UNAVAILABLE", "Please try again shortly.", requestId, { headers: { "Retry-After": "60" } });
  }
}
