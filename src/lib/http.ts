/**
 * Minimal HTTP helpers for Route Handlers (architecture 8.1: JSON in and out, one error envelope,
 * no stack traces to clients, sensitive responses `no-store`). Stage 1 (S1.3) extends the error envelope
 * with the shared Zod schemas; the shape here is already the final one.
 */

export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "TURNSTILE_FAILED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "TEMPORARILY_UNAVAILABLE"
  | "INTERNAL";

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; fields?: Record<string, string> };
  request_id: string;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...headers },
  });
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  extra: { fields?: Record<string, string>; headers?: Record<string, string> } = {},
): Response {
  const body: ErrorEnvelope = {
    error: { code, message, ...(extra.fields ? { fields: extra.fields } : {}) },
    request_id: requestId,
  };
  return jsonResponse(body, status, extra.headers);
}

/**
 * State-changing endpoints check the Origin header (architecture 8.1). A missing Origin (server to
 * server calls, curl) is allowed; a present Origin must match this request's own origin.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid_json" };

/** Reads a JSON body with a hard byte cap, checking the declared length first. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_large" };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, reason: "too_large" };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
