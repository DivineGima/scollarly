import { timingSafeEqual } from "@/lib/timing-safe";

/**
 * The CPU measurement workflow (architecture section 17) posts leads from CI. It proves who it is with a shared secret in a header,
 * so the Worker never has to run with Cloudflare's always-pass Turnstile test secret. A request that carries the right header skips
 * the Turnstile check and its lead is stamped `source.measurement = true` by the server (a client cannot send that key: the lead
 * source schema is strict), which is how the workflow's cleanup finds its own rows and nothing else.
 */

export const MEASUREMENT_HEADER = "x-phase0-token";

const enc = new TextEncoder();

export function isMeasurementRequest(request: Request, token: string | undefined): boolean {
  const supplied = request.headers.get(MEASUREMENT_HEADER);
  if (!supplied || !token) return false;
  return timingSafeEqual(enc.encode(supplied), enc.encode(token));
}
