import { type Actor, AuthError, effectiveRole, hasAtLeast, isRole, isStepUpFresh, mintActor, type ResolvedSession, type Role } from "./actor";
import { readSessionToken } from "./session";

export type ResolveSession = (token: string) => Promise<ResolvedSession | null>;

/**
 * The auth facade (architecture 9.1): `checkSession`, `requireRole`, `requireOwner`.
 *
 * Every call does the one session query (ADR-034): the Neon Auth session is read fresh from the database, so a removed
 * admin or a signed-out session loses access on the very next request (ADR-020). There is no cookie cache to go stale.
 * Built from a resolver so tests can inject a fake; `index.ts` binds it to the real repository.
 */
export function createAuthFacade(resolveSession: ResolveSession) {
  async function checkSession(headers: Headers): Promise<Actor | null> {
    const token = readSessionToken(headers);
    if (!token) return null;
    const session = await resolveSession(token);
    // Sign-in is Google only, so a session for an unverified email is never trusted (tracker: Google-verified-email test).
    if (!session || !session.emailVerified) return null;

    const storedRole: Role = isRole(session.role) ? session.role : "student";
    return mintActor({
      userId: session.userId,
      sessionId: session.sessionId,
      storedRole,
      role: effectiveRole(storedRole, session.stepUpAt),
      twoFactorVerifiedAt: session.stepUpAt,
    });
  }

  async function requireRole(headers: Headers, required: Role): Promise<Actor> {
    const actor = await checkSession(headers);
    if (!actor) throw new AuthError("UNAUTHENTICATED", "Sign in required.");
    if (!hasAtLeast(actor, required)) throw new AuthError("FORBIDDEN", "Not allowed.");
    return actor;
  }

  /** Owner powers need a 2FA-verified session. Destructive owner actions also need a check inside the last 10 minutes. */
  async function requireOwner(headers: Headers, options: { stepUp?: boolean; now?: Date } = {}): Promise<Actor> {
    const actor = await requireRole(headers, "owner");
    if (options.stepUp && !isStepUpFresh(actor, options.now)) {
      throw new AuthError("STEP_UP_REQUIRED", "Confirm your authenticator code to continue.");
    }
    return actor;
  }

  return { checkSession, requireRole, requireOwner };
}

export type AuthFacade = ReturnType<typeof createAuthFacade>;
