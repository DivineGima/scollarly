import { SIGNED_IN_FRAGMENT } from "@/lib/client/signed-in-hint";
import { newRequestId } from "@/lib/http";
import { onboardingPath, readIntent, unconfirmedLanding } from "@/modules/auth/intent";
import { INVITE_TOKEN_PATTERN, landingPathFor } from "@/modules/auth/service";
import { hashInviteToken } from "@/modules/team/service";
import type { Actor } from "@/server/auth/actor";
import { readSessionToken } from "@/server/auth/cookie";
import { contextOf } from "@/server/db/rls";
import { logError } from "@/server/log";
import type { EndpointEnv } from "./endpoint-env";
import { confirmAccount } from "@/server/repositories/account";
import { acceptInvite, bootstrapOwner, scrubSessionPii } from "@/server/repositories/identity";
import { writeAudit } from "@/server/repositories/audit";
import { createSecondFactorStore } from "@/server/repositories/second-factor";

/**
 * `GET /auth/landing`: the first request after Google sign-in has set the session cookie (architecture 16 A9, C0, B0 step 2).
 * A plain function in the Worker entry, like the two sign-in steps before it, so it never starts Next.js. It does four things:
 *
 *  1. refuses to continue without a valid session (back to `/sign-in` with a plain message);
 *  2. clears the visitor's IP address and browser string Neon Auth keeps on the session (flag F13, CLAUDE.md: no raw IPs);
 *  3. if the sign-in carried an invite, accepts it (the database function checks the verified email), otherwise gives the owner
 *     their role when the verified email equals `OWNER_EMAIL` and no owner exists;
 *  4. sends a Google login with no confirmed Scollarly account to the confirm screen (they used Sign in) or confirms it and starts
 *     onboarding (they used Create account), architecture 21.3;
 *  5. sends a student back to the public page they tapped an action on (`next`, checked by `modules/gate/next.ts`), and everyone
 *     else to the page for their role.
 */

export const LANDING_PATH = "/auth/landing";

export interface LandingDeps {
  checkSession: (headers: Headers) => Promise<Actor | null>;
  env: EndpointEnv;
  waitUntil: (task: Promise<unknown>) => void;
}

const redirect = (request: Request, path: string): Response =>
  new Response(null, { status: 302, headers: { Location: new URL(path, request.url).toString(), "Cache-Control": "no-store" } });

export async function handleLanding(request: Request, makeDeps: () => LandingDeps): Promise<Response | null> {
  if (request.method !== "GET" || new URL(request.url).pathname !== LANDING_PATH) return null;
  const { checkSession, env, waitUntil } = makeDeps();

  let actor: Actor | null;
  try {
    actor = await checkSession(request.headers);
  } catch (error) {
    logError(newRequestId(), "auth/landing", error);
    return redirect(request, "/sign-in?error=unavailable");
  }
  const token = readSessionToken(request.headers);
  if (!actor || !token) return redirect(request, "/sign-in?error=failed");

  waitUntil(scrubSessionPii(env.db, token).catch(() => undefined));

  try {
    const invite = new URL(request.url).searchParams.get("invite");
    if (invite !== null) return await landWithInvite(request, env, token, invite);

    let storedRole = actor.storedRole;
    let confirmed = actor.accountConfirmed;
    if (storedRole === "student" && env.ownerEmail && (await bootstrapOwner(env.db, actor.userId, env.ownerEmail))) {
      storedRole = "owner";
      confirmed = true; // promotion confirms the account in the same statement (migration 0013)
      await writeAudit(env.db, actor, { action: "security.ownerBootstrapped", entityType: "app_user", entityId: actor.userId });
    }

    if (!confirmed) {
      const next = unconfirmedLanding(readIntent(new URL(request.url)));
      if (next.confirmNow) await confirmAccount(env.db, contextOf({ userId: actor.userId, role: "student" }));
      return redirect(request, next.path);
    }

    // A student who has not finished onboarding goes to the questionnaire and nowhere else, whichever button they used (PRD_3 F15, ADR-053).
    // The page they came from rides along and is where they go when they finish.
    const intent = readIntent(new URL(request.url));
    if (storedRole === "student" && !actor.onboardingDone) return redirect(request, onboardingPath(intent.as ?? "student", intent.course, true, intent.next));

    // A student who tapped an action on a public page goes back to that page (PRD_3 F20). Staff always go to their own home.
    const back = intent.next;
    if (storedRole === "student" && back) return redirect(request, `${back}${SIGNED_IN_FRAGMENT}`);

    let twoFactorEnrolled = false;
    if (storedRole === "owner") {
      twoFactorEnrolled = (await createSecondFactorStore(env.db, contextOf({ userId: actor.userId, role: "student" })).getTotp(actor.userId))?.confirmed === true;
    }
    return redirect(request, landingPathFor({ storedRole, twoFactorVerified: actor.twoFactorVerifiedAt !== null, twoFactorEnrolled }));
  } catch (error) {
    logError(newRequestId(), "auth/landing", error);
    return redirect(request, "/sign-in?error=unavailable");
  }
}

/** B0 step 2: the role becomes admin only if Google's verified email equals the invited email. */
async function landWithInvite(request: Request, env: EndpointEnv, sessionToken: string, invite: string): Promise<Response> {
  const hash = INVITE_TOKEN_PATTERN.test(invite) ? await hashInviteToken(invite) : null;
  const outcome = hash ? await acceptInvite(env.db, sessionToken, hash) : "invalid";
  // The same message for a wrong email, an expired, used or revoked link, so the page reveals nothing to someone guessing.
  return redirect(request, outcome === "accepted" ? "/admin" : INVITE_TOKEN_PATTERN.test(invite) ? `/accept-invite/${invite}?error=1` : "/sign-in");
}
