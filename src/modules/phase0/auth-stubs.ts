import type { Actor } from "@/server/auth";
import { createHttpDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { adminOverviewStub, sessionCountForActor } from "@/server/repositories/phase0-probe";

/** S0.4: session read (done by the page through the facade) plus exactly one Neon query. */
export async function loadAdminStub(actor: Actor): Promise<{ leadCount: number }> {
  const { leadCount } = await adminOverviewStub(createHttpDb(getEnv().DATABASE_URL), actor);
  return { leadCount };
}

export async function loadStudentStub(actor: Actor): Promise<{ sessions: number }> {
  return { sessions: await sessionCountForActor(createHttpDb(getEnv().DATABASE_URL), actor) };
}
