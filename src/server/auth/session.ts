import { handleAuthProxyRequest, NEON_AUTH_SESSION_COOKIE_NAME, processAuthMiddleware } from "@neondatabase/auth/server";

/**
 * Neon Auth glue (ADR-037). This file and `index.ts` are the only places that import the Neon Auth SDK. We use its
 * framework-neutral `server` entry (plain `Request` and `Response`), not the Next.js adapter, so no `next` imports
 * and no browser SDK reach the Worker.
 *
 * Sign-in and sessions are handled by the managed service. Our Worker only (1) proxies `/api/auth/*` to it so the
 * cookies belong to our own origin, and (2) finishes the Google return trip. Every request after that is checked by
 * the facade with one database query (`facade.ts`), not by the SDK.
 */

export interface NeonAuthConfig {
  /** The Neon Auth URL of the branch, including its path. */
  baseUrl: string;
  /** At least 32 characters. Signs the `session_data` cookie the SDK mints on sign-in. */
  cookieSecret: string;
}

const COOKIE_NAME = NEON_AUTH_SESSION_COOKIE_NAME;
const TOKEN_PATTERN = /^[A-Za-z0-9]{16,64}$/;

/**
 * Reads the opaque session token from the Neon Auth session cookie. Better Auth stores `token.signature`
 * (URL-encoded); the token is the part before the first dot. A malformed value gives null, never an error.
 * The signature is not checked here: the token is a long random value that must exist in the database
 * (`app_resolve_session`), so a forged cookie cannot match a session.
 */
export function readSessionToken(headers: Headers): string | null {
  const header = headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== COOKIE_NAME) continue;
    let value = part.slice(separator + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
    const token = value.split(".")[0] ?? "";
    return TOKEN_PATTERN.test(token) ? token : null;
  }
  return null;
}

/** `/api/auth/[...path]`: forwards the request to Neon Auth and returns its response, cookies included. */
export function proxyAuthRequest(request: Request, path: string, config: NeonAuthConfig): Promise<Response> {
  return handleAuthProxyRequest({ request, path, baseUrl: config.baseUrl, cookieSecret: config.cookieSecret, sameSite: "lax" });
}

/**
 * The page Google sends the user back to (`callbackURL`). When the URL carries Neon's one-time `neon_auth_session_verifier`,
 * it is exchanged for session cookies and the user is redirected to the same URL without it. Otherwise the user goes to
 * `fallbackPath`. The decision comes from the SDK; this function only turns it into a redirect.
 */
export async function completeSignIn(request: Request, config: NeonAuthConfig, fallbackPath: string): Promise<Response> {
  const url = new URL(request.url);
  const decision = await processAuthMiddleware({
    request,
    pathname: url.pathname,
    skipRoutes: [],
    loginUrl: "/",
    baseUrl: config.baseUrl,
    cookieSecret: config.cookieSecret,
    sameSite: "lax",
  });

  const target = decision.action === "allow" ? new URL(fallbackPath, url.origin) : decision.redirectUrl;
  const headers = new Headers({ Location: target.toString(), "Cache-Control": "no-store" });
  for (const cookie of decision.cookies ?? []) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}
