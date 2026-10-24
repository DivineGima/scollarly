/**
 * The browser's side of the edge endpoints (ADR-040). Every call is same-origin with the session cookie, never cached, and
 * never throws: a lost connection and an error answer both come back as a plain result the screen can show.
 */

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiFail {
  ok: false;
  /** 0 when the request never reached the server (offline). */
  status: number;
  /** The error envelope's `code`, or `NETWORK` / `BAD_RESPONSE`. */
  code: string;
  /** Field message tokens, for example `{ code: "INVALID_CODE" }`. */
  fields: Record<string, string>;
  /** Seconds from `Retry-After`, if any. */
  retryAfter: number | null;
}

export type ApiResult<T> = ApiOk<T> | ApiFail;

export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, code: "NETWORK", fields: {}, retryAfter: null };
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Not JSON: handled below.
  }

  if (response.ok) {
    return json === null ? { ok: false, status: response.status, code: "BAD_RESPONSE", fields: {}, retryAfter: null } : { ok: true, data: json as T };
  }
  const error = (json as { error?: { code?: string; fields?: Record<string, string> } } | null)?.error;
  const retry = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  return {
    ok: false,
    status: response.status,
    code: error?.code ?? "BAD_RESPONSE",
    fields: error?.fields ?? {},
    retryAfter: Number.isFinite(retry) ? retry : null,
  };
}

/** A text file the person keeps (recovery codes). Built in the browser; nothing is uploaded. */
export function downloadTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
