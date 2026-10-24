import { type Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { contextOf, inContext } from "@/server/db/rls";
import { adminOverviewQuery, ownRowQuery } from "@/server/repositories/phase0-probe";

/** S0.4 staff data call: exactly one more Neon request after the session query, under row level security. */
export async function loadAdminStub(db: Db, actor: Actor): Promise<{ leadCount: number }> {
  const [rows] = await inContext(db, contextOf(actor), adminOverviewQuery(db));
  return { leadCount: rows[0]?.n ?? 0 };
}

/** S0.4 student data call: the signed-in user's own row, read under row level security. */
export async function loadStudentStub(db: Db, actor: Actor): Promise<{ role: string }> {
  const [rows] = await inContext(db, contextOf(actor), ownRowQuery(db, actor.userId));
  return { role: rows[0]?.role ?? actor.role };
}
