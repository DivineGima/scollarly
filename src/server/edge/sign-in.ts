import { intentParams, readIntent } from "@/modules/auth/intent";
import { INVITE_TOKEN_PATTERN } from "@/modules/auth/service";
import { completeSignIn, configFromEnv, startGoogleSignIn } from "@/server/auth/session";
import { createDurableObjectLimiter, limiterKey } from "@/server/security/rate-limit";
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

/** A well-formed invite token from the query string, or null. Anything else is dropped, never passed on. */
function inviteOf(url: URL): string | null {
  const invite = url.searchParams.get("invite");
  return invite !== null && INVITE_TOKEN_PATTERN.test(invite) ? invite : null;
}

/** Per caller address. Each start costs a Neon Auth call, so a loop of them is limited like every other open entry point. High enough for a carrier address shared by many phones. */
const START_LIMIT = 60;
const START_WINDOW_MS = 10 * 60_000;

type SignInEnv = Pick<CloudflareEnv, "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET" | "RATE_LIMITER" | "RATE_LIMIT_SECRET">;

async function startLimited(request: Request, env: SignInEnv, next: string): Promise<Response> {
  const key = await limiterKey({ route: "auth-start", ip: request.headers.get("cf-connecting-ip") }, env.RATE_LIMIT_SECRET);
  const decision = await createDurableObjectLimiter(env.RATE_LIMITER)(key, START_LIMIT, START_WINDOW_MS);
  // Over the limit: the person lands on the sign-in page with its usual "not available right now" sentence, not on a bare error.
  if (!decision.allowed) return new Response(null, { status: 302, headers: { Location: new URL("/sign-in?error=unavailable", request.url).toString(), "Cache-Control": "no-store" } });
  return startGoogleSignIn(request, configFromEnv(env), next);
}

/** Returns a response for the two sign-in paths, or null for any other request. */
export function handleSignIn(request: Request, env: SignInEnv): Promise<Response> | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const invite = inviteOf(url);
  const params = intentParams(readIntent(url));
  if (invite) params.set("invite", invite);
  const query = params.toString();
  const carry = (path: string) => (query ? `${path}?${query}` : path);
  if (url.pathname === SIGN_IN_START_PATH) return startLimited(request, env, carry(SIGN_IN_RETURN_PATH));
  if (url.pathname === SIGN_IN_RETURN_PATH) return completeSignIn(request, configFromEnv(env), carry(SIGNED_IN_LANDING_PATH));
  return null;
}
