import { intentParams, readIntent } from "@/modules/auth/intent";
import { INVITE_TOKEN_PATTERN } from "@/modules/auth/service";
import { completeSignIn, startGoogleSignIn, type NeonAuthConfig } from "@/server/auth/session";
import { LANDING_PATH } from "./landing";

/**
 * The two sign-in steps that are ours (ADR-037), as plain functions of `(request, env)` run by the Worker entry before Next.js
 * starts, like the lead POST (ADR-033): measured through Next.js, the return trip used 12 to 19 ms of CPU against a 10 ms gate.
 *  - `GET /auth/start`: asks Neon Auth for a Google sign-in and redirects to Google. The sign-in page's button is a link to it.
 *  - `GET /auth/return`: Neon sends the user back here with a one-time verifier; it is exchanged for the session cookies, and
 *    the person goes on to `/auth/landing`, which chooses the page for their role (`edge/landing.ts`).
 * An invite token (`?invite=`) rides along the whole trip, so the landing step can accept the invite (B0). So does the intent
 * (`?intent=sign-up&as=parent&course=law`, architecture 21.3): Sign in and Create account are different buttons, and the landing step
 * uses the intent only for a person who has no confirmed account yet.
 * The Next.js route files call the same functions.
 */

export const SIGN_IN_START_PATH = "/auth/start";
export const SIGN_IN_RETURN_PATH = "/auth/return";
export const SIGNED_IN_LANDING_PATH = LANDING_PATH;

const configOf = (env: Pick<CloudflareEnv, "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET">): NeonAuthConfig => ({
  baseUrl: env.NEON_AUTH_BASE_URL,
  cookieSecret: env.NEON_AUTH_COOKIE_SECRET,
});

/** A well-formed invite token from the query string, or null. Anything else is dropped, never passed on. */
function inviteOf(url: URL): string | null {
  const invite = url.searchParams.get("invite");
  return invite !== null && INVITE_TOKEN_PATTERN.test(invite) ? invite : null;
}

/** Returns a response for the two sign-in paths, or null for any other request. */
export function handleSignIn(request: Request, env: Pick<CloudflareEnv, "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET">): Promise<Response> | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const invite = inviteOf(url);
  const params = intentParams(readIntent(url));
  if (invite) params.set("invite", invite);
  const query = params.toString();
  const carry = (path: string) => (query ? `${path}?${query}` : path);
  if (url.pathname === SIGN_IN_START_PATH) return startGoogleSignIn(request, configOf(env), carry(SIGN_IN_RETURN_PATH));
  if (url.pathname === SIGN_IN_RETURN_PATH) return completeSignIn(request, configOf(env), carry(SIGNED_IN_LANDING_PATH));
  return null;
}
