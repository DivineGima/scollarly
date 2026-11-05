import { newRequestId } from "@/lib/http";
import { CONFIRM_PATH, onboardingPath } from "@/modules/auth/intent";
import { landingPathFor } from "@/modules/auth/service";
import type { Actor } from "@/server/auth/actor";
import { readSessionToken } from "@/server/auth/cookie";
import { contextOf } from "@/server/db/rls";
import { logError } from "@/server/log";
import { createSecondFactorStore } from "@/server/repositories/second-factor";
import type { LandingDeps } from "./landing";

/**
 * The account address (PRD_4 F25, FR-36; architecture 23.7, ADR-060). One address for every person, so the public header never needs a
 * per-person render (public pages stay cached and identical, ADR-002, ADR-033):
 *
 *  - `GET /account`: no session cookie is `302 /sign-in` with no database call. A cookie costs one session read, then `302` to the person's
 *    home. A forged or expired cookie ends at `/sign-in`.
 *  - `GET /sign-in` and `GET /sign-up`: a person who is already signed in is forwarded to the same home instead of being shown a form. A
 *    visitor with no cookie, or with a cookie that is not a real session, gets the cached page as before (`null` here).
 *
 * A plain function in the Worker entry, before Next.js starts, like `/auth/landing`. It never caches (`no-store`) because the answer depends on
 * the cookie.
 */

export const ACCOUNT_PATH = "/account";
const FORWARDED_PATHS: ReadonlySet<string> = new Set(["/sign-in", "/sign-up"]);
const LOCALE_PREFIX = /^\/en(?=\/|$)/;

export type AccountDeps = Pick<LandingDeps, "checkSession" | "env">;

/**
 * Where a signed-in person's account address leads. Pure, so every role and state is a table test. It follows `/auth/landing`: an account that
 * is not confirmed goes to the confirm screen, a student who has not finished onboarding goes to the questionnaire, and everyone else to the
 * home of their role (an owner who has not passed the second factor goes to that step).
 */
export function accountDestination(actor: Pick<Actor, "storedRole" | "accountConfirmed" | "onboardingDone" | "twoFactorVerifiedAt">, twoFactorEnrolled: boolean): string {
  if (!actor.accountConfirmed) return CONFIRM_PATH;
  if (actor.storedRole === "student" && !actor.onboardingDone) return onboardingPath("student", null);
  return landingPathFor({ storedRole: actor.storedRole, twoFactorVerified: actor.twoFactorVerifiedAt !== null, twoFactorEnrolled });
}

function redirect(request: Request, path: string): Response {
  return new Response(null, { status: 302, headers: { Location: new URL(path, request.url).toString(), "Cache-Control": "no-store" } });
}

/** Which of our three addresses this request is for, or null. A `/en` prefix is accepted; a trailing slash is not part of the address. */
function addressOf(url: URL): string | null {
  const path = url.pathname.replace(LOCALE_PREFIX, "").replace(/\/+$/, "") || "/";
  return path === ACCOUNT_PATH || FORWARDED_PATHS.has(path) ? path : null;
}

/** `GET` and `HEAD` only. A response for `/account` and for a signed-in person's `/sign-in` and `/sign-up`, null for everything else. */
export async function handleAccount(request: Request, makeDeps: () => AccountDeps): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const address = addressOf(url);
  if (address === null) return null;

  const token = readSessionToken(request.headers);
  const isAccount = address === ACCOUNT_PATH;
  // A sign-in page that carries a message (`?error=`) is shown as it is: the person has just been sent back to it because something failed.
  if (!isAccount && (token === null || url.searchParams.has("error"))) return null;
  // No cookie at all: nothing to look up, so the answer costs no database call.
  if (token === null) return redirect(request, "/sign-in");

  const { checkSession, env } = makeDeps();
  try {
    const actor = await checkSession(request.headers);
    if (!actor) return isAccount ? redirect(request, "/sign-in") : null;
    let enrolled = false;
    if (actor.accountConfirmed && actor.storedRole === "owner" && actor.twoFactorVerifiedAt === null) {
      enrolled = (await createSecondFactorStore(env.db, contextOf({ userId: actor.userId, role: "student" })).getTotp(actor.userId))?.confirmed === true;
    }
    return redirect(request, accountDestination(actor, enrolled));
  } catch (error) {
    logError(newRequestId(), "account", error);
    // The sign-in page still works if the lookup failed, so a forward that cannot be decided shows the page; `/account` says the service is busy there.
    return isAccount ? redirect(request, "/sign-in?error=unavailable") : null;
  }
}
