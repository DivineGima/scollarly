import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * Row level security context (ADR-038). RLS is a second lock under the auth facade: the policies in
 * migration 0002 read `app.user_id` and `app.role`, and this file is the only place that sets them.
 *
 * The values are set with `set_config(..., true)`, so they last for one transaction. On Neon's HTTP driver a
 * transaction is one HTTP request (`db.batch`), so setting the context and running the queries cost a single
 * round trip. Because our own code sets the values, this protects against a missing check in application code.
 * It is not a defence against SQL injection.
 *
 * Repositories that read or write RLS-protected tables return query builders (not awaited), and callers run them
 * with `inContext`. Sketch:
 *
 *   const [rows] = await inContext(db, contextOf(actor), listLeadsQuery(db));
 */

export type RlsRole = "anonymous" | "student" | "admin" | "owner";

export interface RlsContext {
  userId: string | null;
  role: RlsRole;
}

export const ANONYMOUS: RlsContext = { userId: null, role: "anonymous" };

export function contextOf(actor: { userId: string; role: "student" | "admin" | "owner" }): RlsContext {
  return { userId: actor.userId, role: actor.role };
}

type Runnable = PromiseLike<unknown>;
type ResultsOf<T extends readonly Runnable[]> = { [K in keyof T]: Awaited<T[K]> };

interface Batchable {
  batch: (queries: readonly Runnable[]) => Promise<unknown[]>;
}

function hasBatch(db: unknown): db is Batchable {
  return typeof (db as Partial<Batchable>).batch === "function";
}

/**
 * Runs `queries` in one transaction with the context set first. Returns the results of `queries` only.
 *
 * - Neon HTTP driver (the Worker): `db.batch`, one HTTP request.
 * - Any other driver (tests only, one connection): an explicit transaction. Tests switch the connection to the
 *   `app_runtime` role first (see tests/integration/helpers), so they run as the same role the Worker uses.
 */
export async function inContext<T extends readonly [Runnable, ...Runnable[]]>(
  db: Db,
  ctx: RlsContext,
  ...queries: T
): Promise<ResultsOf<T>> {
  const setContext = db.execute(sql`select set_config('app.user_id', ${ctx.userId ?? ""}, true), set_config('app.role', ${ctx.role}, true)`);

  if (hasBatch(db)) {
    const results = await db.batch([setContext, ...queries]);
    return results.slice(1) as ResultsOf<T>;
  }

  return runInSingleConnectionTransaction(db, setContext, queries) as Promise<ResultsOf<T>>;
}

/** Test-only path. The pool has one connection (or the driver is single-connection PGlite), so statements share a transaction. */
async function runInSingleConnectionTransaction(db: Db, setContext: Runnable, queries: readonly Runnable[]): Promise<unknown[]> {
  await db.execute(sql`begin`);
  try {
    await setContext;
    const results: unknown[] = [];
    for (const query of queries) results.push(await query);
    await db.execute(sql`commit`);
    return results;
  } catch (error) {
    await db.execute(sql`rollback`).catch(() => undefined);
    throw error;
  }
}
