import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { ANONYMOUS, contextOf, inContext } from "@/server/db/rls";

/**
 * How a repository runs its queries (architecture 5 rule 4, ADR-005, ADR-038).
 *
 * A repository function that touches protected data takes an `Actor` as a parameter. Only the auth facade can mint one
 * (`src/server/auth/actor.ts`), so forgetting the authorisation step is a type error. `runAs` then sets the row level
 * security context from that same `Actor` in the same transaction as the queries, so the database is a second lock:
 * the facade decides who may call, and the policies decide which rows that user may see or change.
 *
 *   export async function findLeadById(db: Db, actor: Actor, id: string) {
 *     const [rows] = await runAs(db, actor, db.select().from(lead).where(eq(lead.id, id)));
 *     return rows[0] ?? null;
 *   }
 *
 * Queries are passed un-awaited: they run together in one round trip on Neon's HTTP driver.
 */

type Runnable = PromiseLike<unknown>;
type Results<T extends readonly Runnable[]> = { [K in keyof T]: Awaited<T[K]> };

/** Runs the queries as this signed-in user (their effective role, so an owner without 2FA runs as a student). */
export function runAs<T extends readonly [Runnable, ...Runnable[]]>(db: Db, actor: Actor, ...queries: T): Promise<Results<T>> {
  return inContext(db, contextOf(actor), ...queries);
}

/** Runs the queries as an anonymous visitor: only what the policies make public (published content, settings, stages). */
export function runPublic<T extends readonly [Runnable, ...Runnable[]]>(db: Db, ...queries: T): Promise<Results<T>> {
  return inContext(db, ANONYMOUS, ...queries);
}
