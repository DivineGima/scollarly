/**
 * Cloudflare Turnstile server-side verification (architecture 13.1, ADR-016).
 * The client IP is deliberately not forwarded: raw IP addresses are never sent on or stored.
 */

export type TurnstileResult = "ok" | "failed" | "unavailable";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  secret: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<TurnstileResult> {
  if (!token) return "failed";
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  try {
    const response = await fetchImpl(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return "unavailable";
    const body = (await response.json()) as { success?: unknown };
    return body.success === true ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
}
