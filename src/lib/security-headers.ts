/**
 * Security headers (architecture 13.1). One definition, used by `next.config.ts` (pages and routes served by Next.js)
 * and by the Worker entry (every response, including the plain-function paths that never reach Next.js).
 *
 * The Content-Security-Policy is ENFORCED (Stage 11, S11.1). It was observed in report-only mode through Stages 1 to 10. Next.js inlines
 * small bootstrap scripts into prerendered pages, so `script-src` keeps `'unsafe-inline'`: a nonce would need a dynamic render of every
 * page, which the free plan's CPU limit does not allow (ADR-033). That is the one accepted gap; everything else is closed to the site's own
 * origin, Turnstile and the YouTube privacy domain. `frame-ancestors 'none'` and `X-Frame-Options` keep the site from being framed.
 */

export const CSP = [
  "default-src 'self'",
  // Next.js inlines small scripts and styles; S11.1 decides whether nonces can replace 'unsafe-inline'.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // blob: is the picture the admin has just chosen, shown before it is uploaded (the image upload screen).
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  // Tour videos (FR-3) and the Turnstile widget.
  "frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": CSP,
};

/** The same headers in the `{ key, value }` form Next.js's `headers()` expects. */
export function securityHeaderList(): { key: string; value: string }[] {
  return Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value }));
}

/**
 * Adds any security header the response does not already carry and returns it. A response from `fetch` or the Cache API
 * has immutable headers, so the response is copied first. Switching-protocol responses are returned untouched.
 */
export function applySecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  const missing = Object.entries(SECURITY_HEADERS).filter(([name]) => !response.headers.has(name));
  if (missing.length === 0) return response;
  const copy = new Response(response.body, response);
  for (const [name, value] of missing) copy.headers.set(name, value);
  return copy;
}
