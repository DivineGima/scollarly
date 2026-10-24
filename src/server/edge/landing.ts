import { INVITE_TOKEN_PATTERN, landingPathFor } from "@/modules/auth/service";
import { hashInviteToken } from "@/modules/team/service";
import type { Actor } from "@/server/auth/actor";
import { readSessionToken } from "@/server/auth/cookie";
import { contextOf } from "@/server/db/rls";
import type { EndpointEnv } from "./endpoint-env";
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
 *  4. sends the person to the page for their role.
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
  } catch {
    return redirect(request, "/sign-in?error=unavailable");
  }
  const token = readSessionToken(request.headers);
  if (!actor || !token) return redirect(request, "/sign-in?error=failed");

  waitUntil(scrubSessionPii(env.db, token).catch(() => undefined));

  try {
    const invite = new URL(request.url).searchParams.get("invite");
    if (invite !== null) return await landWithInvite(request, env, token, invite);

    let storedRole = actor.storedRole;
    if (storedRole === "student" && env.ownerEmail && (await bootstrapOwner(env.db, actor.userId, env.ownerEmail))) {
      storedRole = "owner";
      await writeAudit(env.db, actor, { action: "security.ownerBootstrapped", entityType: "app_user", entityId: actor.userId });
    }

    let twoFactorEnrolled = false;
    if (storedRole === "owner") {
      twoFactorEnrolled = (await createSecondFactorStore(env.db, contextOf({ userId: actor.userId, role: "student" })).getTotp(actor.userId))?.confirmed === true;
    }
    return redirect(request, landingPathFor({ storedRole, twoFactorVerified: actor.twoFactorVerifiedAt !== null, twoFactorEnrolled }));
  } catch {
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
