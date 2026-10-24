import { handleAuthProxyRequest, processAuthMiddleware } from "@neondatabase/auth/server";

export { readSessionToken, SESSION_COOKIE_NAME } from "./cookie";

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

/**
 * Starts Google sign-in with one GET (Stage 0 only: the real sign-in page is S2.2, and it does the same thing from a button).
 * Neon Auth's social sign-in is a POST that answers with the Google URL and sets a short-lived state cookie on our origin.
 * This makes that POST, then redirects the browser to Google with the cookie. `returnPath` is where Neon sends the user back.
 */
export async function startGoogleSignIn(request: Request, config: NeonAuthConfig, returnPath: string): Promise<Response> {
  const origin = new URL(request.url).origin;
  const proxied = await proxyAuthRequest(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: request.headers.get("cookie") ?? "" },
      body: JSON.stringify({ provider: "google", callbackURL: new URL(returnPath, origin).toString() }),
    }),
    "sign-in/social",
    config,
  );

  let target = proxied.headers.get("location");
  if (!target) {
    try {
      target = ((await proxied.clone().json()) as { url?: string }).url ?? null;
    } catch {
      target = null;
    }
  }
  if (!target) return new Response("Sign-in could not be started.", { status: 502, headers: { "Cache-Control": "no-store" } });

  const headers = new Headers({ Location: target, "Cache-Control": "no-store" });
  for (const cookie of proxied.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}
