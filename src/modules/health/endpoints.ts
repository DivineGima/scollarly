import { AuthError } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { healthData } from "@/server/repositories/health";
import { DATABASE_BUDGET_BYTES, usageOf } from "./service";

/**
 * The Health page (S10.2; architecture 13.2, 16 C7): the owner only. Database size, image use against the budget, when each daily job last
 * ran, how many fees and links are stale, and the state of the page-view switch. Compute and request use are Neon's and Cloudflare's own
 * dashboards (linked from the screen), because the free plans give the Worker no way to read them.
 */
export function healthDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    "admin/health": async (actor) => {
      if (actor.role !== "owner") throw new AuthError("FORBIDDEN", "Not allowed.");
      const data = await healthData(env.db, actor);
      return {
        checkedAt: env.now().toISOString(),
        database: usageOf(data.usage.dbBytes, DATABASE_BUDGET_BYTES),
        images: usageOf(data.usage.imageBytes, data.usage.imageBudgetBytes),
        jobs: data.jobs,
        stale: data.stale,
        collectPageViews: data.collectPageViews,
        pipeline: data.pipeline,
      };
    },
  };
}
