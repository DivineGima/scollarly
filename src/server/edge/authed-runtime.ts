import { loadAdminStub, loadStudentStub } from "@/modules/phase0/auth-stubs";
import { createAuthFacade } from "@/server/auth/facade";
import { getDb } from "@/server/db/runtime";
import { resolveSession } from "@/server/repositories/identity";
import type { AuthedDeps } from "./authed";

/**
 * Binds the signed-in screen handler (`authed.ts`) to the real database for the Worker entry. The facade is the
 * same one the rest of the app uses; here it is built from the Worker's own `env`, not from the Next.js request context.
 * Stage 0 has two data calls; each later stage adds its own to `api` (ADR-040).
 */
export function authedDeps(env: CloudflareEnv, rest: Pick<AuthedDeps, "cache" | "next" | "waitUntil">): AuthedDeps {
  const db = getDb(env);
  const facade = createAuthFacade((token) => resolveSession(db, token));
  return {
    ...rest,
    checkSession: facade.checkSession,
    api: {
      "admin/phase0": (actor) => loadAdminStub(db, actor),
      "me/phase0": (actor) => loadStudentStub(db, actor),
    },
  };
}
