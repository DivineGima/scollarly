/**
 * The branded `Actor` (architecture section 5, rule 4 and ADR-005).
 *
 * Every protected repository method takes an `Actor`. The only code that can produce one is
 * `mintActor`, and it is deliberately NOT re-exported from `src/server/auth/index.ts`, so forgetting an
 * authorisation check is a type error rather than a code-review finding.
 *
 * This file imports nothing from Better Auth, so repositories can import the type without breaking the
 * "only server/auth imports Better Auth" rule (it is inside server/auth).
 */

declare const actorBrand: unique symbol;

export type Role = "student" | "admin" | "owner";

export const STEP_UP_WINDOW_MS = 10 * 60 * 1000; // architecture 9.3 step 5 [Mine, confirm]

export interface ActorData {
  userId: string;
  sessionId: string;
  /** The role stored on the user row. */
  storedRole: Role;
  /**
   * The role this request may act with. An owner whose session has not passed the 2FA check has no
   * admin or owner powers and is treated as a student (architecture 9.3 step 4).
   */
  role: Role;
  /** When this session last passed a TOTP or recovery-code check. Null if never. */
  twoFactorVerifiedAt: Date | null;
}

export type Actor = Readonly<ActorData> & { readonly [actorBrand]: true };

export function mintActor(data: ActorData): Actor {
  return Object.freeze({ ...data }) as Actor;
}

export function isRole(value: unknown): value is Role {
  return value === "student" || value === "admin" || value === "owner";
}

/** Pure: decides the effective role from what is stored. Unknown stored values fall back to student. */
export function effectiveRole(storedRole: unknown, twoFactorVerifiedAt: Date | null): Role {
  if (!isRole(storedRole)) return "student";
  if (storedRole === "owner" && twoFactorVerifiedAt === null) return "student";
  return storedRole;
}

/** Pure: has this session passed a second-factor check inside the step-up window? */
export function isStepUpFresh(actor: Pick<ActorData, "twoFactorVerifiedAt">, now: Date = new Date()): boolean {
  if (actor.twoFactorVerifiedAt === null) return false;
  const age = now.getTime() - actor.twoFactorVerifiedAt.getTime();
  return age >= 0 && age <= STEP_UP_WINDOW_MS;
}

export function hasAtLeast(actor: Pick<ActorData, "role">, required: Role): boolean {
  const rank: Record<Role, number> = { student: 0, admin: 1, owner: 2 };
  return rank[actor.role] >= rank[required];
}

export type AuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "STEP_UP_REQUIRED";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
