import { classifyLeadResponse, type QueuedLead } from "./logic";

/** One attempt to send a queued lead to `POST /api/v1/leads` (architecture 8.2). It never throws: every outcome is a result. */

export type SendResult =
  | { verdict: "sent"; ref: string; replayed: boolean }
  | { verdict: "rejected"; status: number; code: string; fields: Record<string, string> }
  | { verdict: "limited"; retryAfterSeconds: number; reason: "number_limit" | "rate" }
  | { verdict: "retry"; status: number; code: string; retryAfterSeconds: number | null };

export const LEADS_ENDPOINT = "/api/v1/leads";
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A signal that aborts after `ms`. `AbortSignal.timeout` exists only from Chrome 103 and Safari 16, and without it every send would
 * throw before reaching the network and look like a lost connection, so an older phone could never deliver an application.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export async function sendLead(
  item: Pick<QueuedLead, "key" | "payload">,
  turnstileToken: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetchImpl(LEADS_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": item.key },
      body: JSON.stringify({ ...item.payload, turnstile_token: turnstileToken }),
      signal: timeoutSignal(timeoutMs),
    });
  } catch {
    return { verdict: "retry", status: 0, code: "NETWORK", retryAfterSeconds: null };
  }

  type Body = { status?: string; ref?: string; error?: { code?: string; fields?: Record<string, string> } };
  let json = null as Body | null;
  try {
    json = (await response.json()) as Body;
  } catch {
    // Not JSON (a proxy error page): treated by status below.
  }

  const verdict = classifyLeadResponse(response.status);
  const retryHeader = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  const retryAfterSeconds = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null;
  const code = json?.error?.code ?? "BAD_RESPONSE";
  const fields = json?.error?.fields ?? {};

  switch (verdict) {
    case "sent":
      // A success without a reference cannot be shown to the student; treat it as a failed attempt and retry (the key makes that safe).
      return typeof json?.ref === "string"
        ? { verdict: "sent", ref: json.ref, replayed: json.status === "replayed" || response.status === 200 }
        : { verdict: "retry", status: response.status, code: "BAD_RESPONSE", retryAfterSeconds: null };
    case "rejected":
      return { verdict: "rejected", status: response.status, code, fields };
    case "limited":
      return { verdict: "limited", retryAfterSeconds: retryAfterSeconds ?? 60, reason: fields.reason === "number_limit" ? "number_limit" : "rate" };
    case "retry":
      return { verdict: "retry", status: response.status, code, retryAfterSeconds };
  }
}
