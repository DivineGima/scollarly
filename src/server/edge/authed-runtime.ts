import { loadAdminStub, loadStudentStub } from "@/modules/phase0/auth-stubs";
import { auditDataCalls } from "@/modules/audit/endpoints";
import { leadDataCalls, leadMutations } from "@/modules/leads/admin-endpoints";
import { authDataCalls, authMutations } from "@/modules/auth/endpoints";
import { profileDataCalls, profileMutations } from "@/modules/profile/endpoints";
import { teamDataCalls, teamMutations } from "@/modules/team/endpoints";
import { createAuthFacade } from "@/server/auth/facade";
import { getDb } from "@/server/db/runtime";
import { resolveSession } from "@/server/repositories/identity";
import { createDurableObjectLimiter, limiterKey } from "@/server/security/rate-limit";
import type { AuthedDeps } from "./authed";
import type { EndpointEnv } from "./endpoint-env";
import type { LandingDeps } from "./landing";
import type { MutationDeps } from "./mutations";

/**
 * Binds the signed-in handlers (`authed.ts` data calls and shells, `mutations.ts`, `landing.ts`) to the real database for the
 * Worker entry. The facade is the same one the rest of the app uses; here it is built from the Worker's own `env`, not from
 * the Next.js request context. Each stage adds its modules to the two registries below (ADR-040).
 */

export function endpointEnv(env: CloudflareEnv): EndpointEnv {
  return { db: getDb(env), ownerEmail: env.OWNER_EMAIL ?? "", totpKey: env.TOTP_ENCRYPTION_KEY, now: () => new Date() };
}

function facadeFor(endpoint: EndpointEnv) {
  return createAuthFacade((token) => resolveSession(endpoint.db, token));
}

export function authedDeps(env: CloudflareEnv, rest: Pick<AuthedDeps, "cache" | "next" | "waitUntil">): AuthedDeps {
  const endpoint = endpointEnv(env);
  return {
    ...rest,
    checkSession: facadeFor(endpoint).checkSession,
    api: {
      "admin/phase0": (actor) => loadAdminStub(endpoint.db, actor),
      "me/phase0": (actor) => loadStudentStub(endpoint.db, actor),
      ...authDataCalls(endpoint),
      ...profileDataCalls(endpoint),
      ...teamDataCalls(endpoint),
      ...auditDataCalls(endpoint),
      ...leadDataCalls(endpoint),
    },
  };
}

export function mutationDeps(env: CloudflareEnv): MutationDeps {
  const endpoint = endpointEnv(env);
  const limiter = createDurableObjectLimiter(env.RATE_LIMITER);
  return {
    checkSession: facadeFor(endpoint).checkSession,
    env: endpoint,
    mutations: { ...authMutations, ...profileMutations, ...teamMutations, ...leadMutations },
    // The caller is hashed with a daily salt at once; the raw address is never stored or logged (ADR-027).
    limit: async (operation, request, max, windowMs) =>
      limiter(await limiterKey({ route: operation, ip: request.headers.get("cf-connecting-ip") }, env.RATE_LIMIT_SECRET), max, windowMs),
  };
}

export function landingDeps(env: CloudflareEnv, waitUntil: LandingDeps["waitUntil"]): LandingDeps {
  const endpoint = endpointEnv(env);
  return { checkSession: facadeFor(endpoint).checkSession, env: endpoint, waitUntil };
}
