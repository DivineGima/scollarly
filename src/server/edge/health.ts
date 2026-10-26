import { errorResponse, jsonResponse, newRequestId } from "@/lib/http";
import { AuthError, type Actor } from "@/server/auth/actor";
import { logError } from "@/server/log";

/**
 * `GET /api/v1/health` (architecture 8.2). Plain: `200 {status, version}`, no database, no session. This is what CI and the hourly uptime
 * workflow (S11.8) call, so it proves the Worker is up and nothing else.
 *
 * `?deep=1` is for an admin or the owner who wants to know if the database answers: it needs a session, runs one trivial query, and says
 * `503` with `status: "degraded"` when Neon does not answer within a few seconds. It is never used by the uptime workflow, which must
 * not wake Neon every hour (architecture 12, "no keep-warm pings").
 */

export const DEEP_CHECK_TIMEOUT_MS = 4000;

export interface HealthDeps {
  version: string;
  requireAdmin: (headers: Headers) => Promise<Actor>;
  /** Resolves when the database answered `select 1`. */
  pingDatabase: () => Promise<void>;
}

export async function handleHealth(request: Request, deps: HealthDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("deep") !== "1") return jsonResponse({ status: "ok", version: deps.version });

  const requestId = newRequestId();
  try {
    await deps.requireAdmin(request.headers);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.code === "UNAUTHENTICATED" ? 401 : 403, error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", error.message, requestId);
    logError(requestId, "health", error);
    return errorResponse(503, "TEMPORARILY_UNAVAILABLE", "Please try again shortly.", requestId, { headers: { "Retry-After": "5" } });
  }

  try {
    await Promise.race([
      deps.pingDatabase(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), DEEP_CHECK_TIMEOUT_MS)),
    ]);
    return jsonResponse({ status: "ok", version: deps.version, database: "ok" });
  } catch (error) {
    logError(requestId, "health", error);
    return jsonResponse({ status: "degraded", version: deps.version, database: "unreachable" }, 503, { "Retry-After": "10" });
  }
}
