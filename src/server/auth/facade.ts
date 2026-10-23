import type { Auth } from "./auth";
import { type Actor, AuthError, effectiveRole, hasAtLeast, isRole, isStepUpFresh, mintActor, type Role } from "./actor";

export interface CheckSessionOptions {
  /**
   * ADR-020: staff always do a fresh session lookup so a removed admin loses access on the very next
   * request. Only student `/me` reads may opt in to the (at most 60 s) signed cookie cache.
   */
  allowCookieCache?: boolean;
}

/**
 * The auth facade (architecture 9.1): `checkSession`, `requireRole`, `requireOwner`.
 * Built from a getter so tests can inject an auth instance; `index.ts` binds it to the real one.
 */
export function createAuthFacade(getAuth: () => Auth) {
  async function lookup(headers: Headers, fresh: boolean) {
    return getAuth().api.getSession({ headers, query: { disableCookieCache: fresh } });
  }

  async function checkSession(headers: Headers, options: CheckSessionOptions = {}): Promise<Actor | null> {
    let result = await lookup(headers, !options.allowCookieCache);
    // A cached copy may only be trusted for students. Anything privileged is re-read from the database.
    if (options.allowCookieCache && result && result.user.role !== "student") {
      result = await lookup(headers, true);
    }
    if (!result) return null;

    const storedRole: Role = isRole(result.user.role) ? result.user.role : "student";
    const verifiedAt = toDate(result.session.twoFactorVerifiedAt);
    return mintActor({
      userId: result.user.id,
      sessionId: result.session.id,
      storedRole,
      role: effectiveRole(storedRole, verifiedAt),
      twoFactorVerifiedAt: verifiedAt,
    });
  }

  async function requireRole(headers: Headers, required: Role, options: CheckSessionOptions = {}): Promise<Actor> {
    const actor = await checkSession(headers, options);
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

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type AuthFacade = ReturnType<typeof createAuthFacade>;
