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

/**
 * The request body as bytes, never holding more than `maxBytes` of it. The declared `Content-Length` is only a hint (a chunked
 * body has none, and a client can lie), so the stream is counted as it is read and cancelled the moment it passes the cap. A plain
 * `request.text()` would buffer the whole body first, up to the platform limit, before any size check ran.
 */
export async function readCappedBytes(request: Request, maxBytes: number): Promise<{ ok: true; value: Uint8Array } | { ok: false }> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, value: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, value: bytes };
}

/**
 * Reads a JSON body with a hard byte cap (`readCappedBytes`). An empty body is invalid JSON, unless `emptyIs` gives the value it
 * stands for (an operation with no input, such as sign out everywhere, needs no payload).
 */
export async function readJsonBody(request: Request, maxBytes: number, options: { emptyIs?: unknown } = {}): Promise<BodyResult> {
  const read = await readCappedBytes(request, maxBytes);
  if (!read.ok) return { ok: false, reason: "too_large" };
  const text = new TextDecoder().decode(read.value);
  if (text.trim() === "" && "emptyIs" in options) return { ok: true, value: options.emptyIs };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
