import { completeSignIn, startGoogleSignIn, type NeonAuthConfig } from "@/server/auth/session";

/**
 * The two sign-in steps that are ours (ADR-037), as plain functions of `(request, env)` run by the Worker entry before Next.js
 * starts, like the lead POST (ADR-033): measured through Next.js, the return trip used 12 to 19 ms of CPU against a 10 ms gate.
 *  - `GET /auth/start`: asks Neon Auth for a Google sign-in and redirects to Google (Stage 0 only; S2.2 adds the real page).
 *  - `GET /auth/return`: Neon sends the user back here with a one-time verifier; it is exchanged for the session cookies.
 * The Next.js route files call the same functions.
 */

export const SIGN_IN_START_PATH = "/auth/start";
export const SIGN_IN_RETURN_PATH = "/auth/return";
export const SIGNED_IN_LANDING_PATH = "/me/phase0"; // Stage 0 landing page; S2.2 chooses the landing page by role

const configOf = (env: Pick<CloudflareEnv, "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET">): NeonAuthConfig => ({
  baseUrl: env.NEON_AUTH_BASE_URL,
  cookieSecret: env.NEON_AUTH_COOKIE_SECRET,
});

/** Returns a response for the two sign-in paths, or null for any other request. */
export function handleSignIn(request: Request, env: CloudflareEnv): Promise<Response> | null {
  if (request.method !== "GET") return null;
  const { pathname } = new URL(request.url);
  if (pathname === SIGN_IN_START_PATH) return startGoogleSignIn(request, configOf(env), SIGN_IN_RETURN_PATH);
  if (pathname === SIGN_IN_RETURN_PATH) return completeSignIn(request, configOf(env), SIGNED_IN_LANDING_PATH);
  return null;
}
