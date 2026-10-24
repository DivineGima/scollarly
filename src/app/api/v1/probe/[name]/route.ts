import { jsonResponse, newRequestId, errorResponse } from "@/lib/http";
import { probes } from "@/modules/phase0/probes";
import { timingSafeEqual } from "@/lib/timing-safe";
import { getEnv } from "@/server/env";

/**
 * Stage 0 measurement probes (architecture section 17). Guarded by a shared secret and answered with a
 * plain 404 when it is missing or wrong, so the routes are invisible without it. Removed after Stage 0.
 */

const enc = new TextEncoder();

async function handle(request: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const requestId = newRequestId();
  const env = getEnv();
  const supplied = enc.encode(request.headers.get("x-phase0-token") ?? "");
  const expected = enc.encode(env.PHASE0_PROBE_TOKEN ?? "");
  if (expected.length === 0 || !timingSafeEqual(supplied, expected)) {
    return errorResponse(404, "NOT_FOUND", "Not found.", requestId);
  }

  const { name } = await params;
  const probe = probes[name];
  if (!probe) return errorResponse(404, "NOT_FOUND", "Unknown probe.", requestId);

  try {
    const result = await probe({ env, url: new URL(request.url) });
    return jsonResponse({ probe: name, ...result });
  } catch (error) {
    // Probe failures are the measurement: report the error class, never the message (it may carry connection details).
    return jsonResponse({ probe: name, ok: false, error: error instanceof Error ? error.name : "Error" }, 500);
  }
}

export const GET = handle;
export const POST = handle;
