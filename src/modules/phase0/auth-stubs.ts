import { type Actor } from "@/server/auth";
import { contextOf, inContext } from "@/server/db/rls";
import { getDb } from "@/server/db/runtime";
import { getEnv } from "@/server/env";
import { adminOverviewQuery, ownRowQuery } from "@/server/repositories/phase0-probe";

/** S0.4: the session read is done by the page through the facade; this is exactly one more Neon request, under row level security. */
export async function loadAdminStub(actor: Actor): Promise<{ leadCount: number }> {
  const db = getDb(getEnv());
  const [rows] = await inContext(db, contextOf(actor), adminOverviewQuery(db));
  return { leadCount: rows[0]?.n ?? 0 };
}

export async function loadStudentStub(actor: Actor): Promise<{ role: string }> {
  const db = getDb(getEnv());
  const [rows] = await inContext(db, contextOf(actor), ownRowQuery(db, actor.userId));
  return { role: rows[0]?.role ?? actor.role };
}
