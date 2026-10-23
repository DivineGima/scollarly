import { toNextJsHandler } from "better-auth/next-js";
import { createAuthFacade } from "./facade";
import { getAuth } from "./instance";

/**
 * Public surface of the auth module. Everything outside `src/server/auth` imports from here and
 * never from `better-auth`. `mintActor` is intentionally not exported.
 */
export { type Actor, AuthError, type AuthErrorCode, isStepUpFresh, type Role, STEP_UP_WINDOW_MS } from "./actor";
export { createAuthFacade, type AuthFacade, type CheckSessionOptions } from "./facade";
export { HASH_VARIANTS, isHashVariant, type HashVariant, hashPasswordPbkdf2, timingSafeEqual, verifyPasswordPbkdf2 } from "./password";
export type { Auth } from "./auth";
export { getAuth } from "./instance";
export { runSigninProbe, type ProbeRole, type SigninProbeResult } from "./probe";

const facade = createAuthFacade(() => getAuth());
export const checkSession = facade.checkSession;
export const requireRole = facade.requireRole;
export const requireOwner = facade.requireOwner;

/** `/api/auth/*` route handlers (GET and POST) for the Next.js route file. */
export function authRouteHandlers() {
  return toNextJsHandler(getAuth());
}
