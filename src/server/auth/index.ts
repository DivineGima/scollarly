import { getDb } from "@/server/db/runtime";
import { getEnv } from "@/server/env";
import { resolveSession } from "@/server/repositories/identity";
import { createAuthFacade } from "./facade";

/**
 * Public surface of the auth module (ADR-005, ADR-037). Everything outside `src/server/auth` imports from here and
 * never from `@neondatabase/auth` or `otpauth`. `mintActor` is intentionally not exported.
 */
export { type Actor, AuthError, type AuthErrorCode, isStepUpFresh, type Role, STEP_UP_WINDOW_MS } from "./actor";
export { createAuthFacade, type AuthFacade, type ResolveSession } from "./facade";
export { completeSignIn, isAllowedAuthRoute, proxyAuthRequest, readSessionToken, startGoogleSignIn, type NeonAuthConfig } from "./session";
export {
  createSecondFactor,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  type SecondFactor,
  type SecondFactorStore,
  type VerifyResult,
} from "./second-factor";

/** The facade bound to the real database. Every call is one query (ADR-034), so there is no cache to go stale (ADR-020). */
const facade = createAuthFacade((token) => resolveSession(getDb(getEnv()), token));
export const checkSession = facade.checkSession;
export const requireRole = facade.requireRole;
export const requireOwner = facade.requireOwner;
export { ACTION_PERMISSION, type ActionId, can, canDo, PERMISSION_ROLES, PERMISSIONS, type PermissionId, type PermissionRole } from "./permissions";
