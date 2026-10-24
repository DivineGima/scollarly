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
  | "CONFLICT"
  | "STEP_UP_REQUIRED"
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

/** The HTTP status each error code is sent with (architecture 8.1, 8.2). */
export const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STEP_UP_REQUIRED: 403,
  TURNSTILE_FAILED: 403,
  IDEMPOTENCY_KEY_REUSED: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  TEMPORARILY_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** The envelope for a code, with its standard status. `RATE_LIMITED` and `TEMPORARILY_UNAVAILABLE` should pass a `Retry-After` header. */
export function errorResponseFor(
  code: ErrorCode,
  message: string,
  requestId: string,
  extra: { fields?: Record<string, string>; headers?: Record<string, string> } = {},
): Response {
  return errorResponse(STATUS_BY_CODE[code], code, message, requestId, extra);
}

/** What a Zod issue looks like, so this file needs no import of Zod. */
export interface FieldIssue {
  path: readonly PropertyKey[];
  message: string;
}

/**
 * Turns validation issues into the `fields` of the error envelope: dotted path to message token. The first issue for a
 * path wins. The messages are tokens such as `REQUIRED` that the UI maps to a translation key (FR-15).
 */
export function fieldErrors(issues: readonly FieldIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "body";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function validationErrorResponse(issues: readonly FieldIssue[], requestId: string): Response {
  return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: fieldErrors(issues) });
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
