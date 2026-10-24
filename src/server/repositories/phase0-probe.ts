import { eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { ANONYMOUS, inContext } from "@/server/db/rls";
import { appUser, phase0Content } from "@/server/db/schema";
import { countStubLeadsQuery } from "./phase0-leads";

/** S0.3: the one HTTP query. */
export async function selectOne(db: Db): Promise<number> {
  const rows = rowsOf<{ one: number }>(await db.execute(sql`select 1 as one`));
  return Number(rows[0]?.one ?? 0);
}

/** S0.3: the one WebSocket transaction (two statements inside a transaction). */
export async function transactionRoundTrip(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1`);
    const rows = rowsOf<{ two: number }>(await tx.execute(sql`select 2 as two`));
    return Number(rows[0]?.two ?? 0);
  });
}

/**
 * S0.4: the stub admin page's single Neon query. Run it with `inContext` (the policy lets only staff read leads), so
 * the measured path is the real one: the session query, then one query under row level security.
 */
export const adminOverviewQuery = countStubLeadsQuery;

/** S0.4: the stub student page's single Neon query: the signed-in user's own `app_user` row, read under row level security. */
export function ownRowQuery(db: Db, userId: string) {
  return db.select({ role: appUser.role, createdAt: appUser.createdAt }).from(appUser).where(eq(appUser.id, userId)).limit(1);
}

// ---- S0.6: tag revalidation content ------------------------------------------------------------

export const PHASE0_CONTENT_KEY = "phase0-title";

/** Public content: readable without a signed-in user. Run it with `inContext(db, ANONYMOUS, ...)` under the runtime role. */
export function readPhase0TitleQuery(db: Db) {
  return db.select({ value: phase0Content.value }).from(phase0Content).where(eq(phase0Content.key, PHASE0_CONTENT_KEY)).limit(1);
}

/** Staff write: run it with an admin context. */
export function writePhase0TitleQuery(db: Db, value: string) {
  return db
    .insert(phase0Content)
    .values({ key: PHASE0_CONTENT_KEY, value })
    .onConflictDoUpdate({ target: phase0Content.key, set: { value, updatedAt: new Date() } });
}

// ---- S0.10: row level security probe -------------------------------------------------------------

export interface RlsProbeResult {
  role: string | null;
  bypassesRls: boolean | null;
  appUserRowsVisibleWithoutContext: number | null;
  neonAuthReadable: boolean;
}

/**
 * Asks the live database who this connection is, whether an unauthenticated read of `app_user` returns rows, and whether
 * Neon Auth's own tables are closed to the runtime role (ADR-038).
 */
export async function rlsProbe(db: Db): Promise<RlsProbeResult> {
  const [whoRows, userRows] = await inContext(
    db,
    ANONYMOUS,
    db.execute(sql`select current_user::text as who, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`),
    db.execute(sql`select count(*)::int as n from public.app_user`),
  );
  const who = rowsOf<{ who: string; bypass: boolean }>(whoRows)[0];
  let neonAuthReadable = false;
  try {
    await db.execute(sql`select 1 from neon_auth.session limit 1`);
    neonAuthReadable = true;
  } catch {
    // permission denied: the runtime role has no grant on the neon_auth schema
  }
  return {
    role: who?.who ?? null,
    bypassesRls: who?.bypass ?? null,
    appUserRowsVisibleWithoutContext: rowsOf<{ n: number }>(userRows)[0]?.n ?? null,
    neonAuthReadable,
  };
}
