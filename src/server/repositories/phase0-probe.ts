import { count, eq, sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { account, phase0Content, phase0LeadStub, session, user } from "@/server/db/schema";

/** Raw `execute` results are an array on the Neon HTTP driver and `{ rows }` on the WebSocket and node-postgres drivers. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

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
 * S0.4: the stub admin page's single Neon query. Takes an `Actor`, so it cannot be called without
 * going through the auth facade (architecture 5, rule 4).
 */
export async function adminOverviewStub(db: Db, actor: Actor): Promise<{ leadCount: number; viewedBy: string }> {
  const [row] = await db.select({ n: count() }).from(phase0LeadStub);
  return { leadCount: row?.n ?? 0, viewedBy: actor.userId };
}

/** S0.4: the student stub page's single Neon query (the cookie-cache path used by `/me`). Takes an `Actor`. */
export async function sessionCountForActor(db: Db, actor: Actor): Promise<number> {
  const [row] = await db.select({ n: count() }).from(session).where(eq(session.userId, actor.userId));
  return row?.n ?? 0;
}

// ---- S0.4: owner index and probe users --------------------------------------------------------

export async function countOwners(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(user).where(eq(user.role, "owner"));
  return row?.n ?? 0;
}

/**
 * Sets a user's role to owner. The partial unique index `user_single_owner` makes a second owner fail
 * at the database, whatever the application code does.
 */
export async function promoteToOwner(db: Db, userId: string): Promise<void> {
  await db.update(user).set({ role: "owner", updatedAt: new Date() }).where(eq(user.id, userId));
}

export interface ProbeUserInput {
  id: string;
  email: string;
  name: string;
  role: "student" | "admin";
  /** Password hash in the variant's own format, or null for a passwordless user. */
  passwordHash: string | null;
}

/**
 * Creates (or leaves alone) a verified Phase 0 probe user so sign-in CPU can be measured without a
 * verification email. Probe users use the reserved `.invalid` domain and are removed with the probes.
 */
export async function ensureProbeUser(db: Db, input: ProbeUserInput): Promise<void> {
  await db
    .insert(user)
    .values({ id: input.id, email: input.email, name: input.name, emailVerified: true, role: input.role })
    .onConflictDoNothing({ target: user.email });
  if (input.passwordHash) {
    await db
      .insert(account)
      .values({
        id: `${input.id}-credential`,
        accountId: input.id,
        providerId: "credential",
        userId: input.id,
        password: input.passwordHash,
      })
      .onConflictDoNothing();
  }
}

export async function findUserIdByEmail(db: Db, email: string): Promise<string | null> {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  return row?.id ?? null;
}

// ---- S0.6: tag revalidation content ------------------------------------------------------------

export const PHASE0_CONTENT_KEY = "phase0-title";

export async function readPhase0Title(db: Db): Promise<string | null> {
  const [row] = await db.select({ value: phase0Content.value }).from(phase0Content).where(eq(phase0Content.key, PHASE0_CONTENT_KEY)).limit(1);
  return row?.value ?? null;
}

export async function writePhase0Title(db: Db, value: string): Promise<void> {
  await db
    .insert(phase0Content)
    .values({ key: PHASE0_CONTENT_KEY, value })
    .onConflictDoUpdate({ target: phase0Content.key, set: { value, updatedAt: new Date() } });
}
