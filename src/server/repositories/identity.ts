import { eq, sql } from "drizzle-orm";
import type { ResolvedSession } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { appUser } from "@/server/db/schema";

interface SessionRow {
  user_id: string;
  session_id: string;
  email: string;
  email_verified: boolean;
  role: string;
  step_up_at: string | Date | null;
}

/**
 * The single query the auth facade runs per request (ADR-034). The SECURITY DEFINER function looks the Neon Auth
 * session up, creates the `app_user` row on the first sign-in (idempotent), and returns the role and the step-up
 * time. Returns null for an unknown, expired or banned session.
 */
export async function resolveSession(db: Db, token: string): Promise<ResolvedSession | null> {
  const [row] = rowsOf<SessionRow>(await db.execute(sql`select * from public.app_resolve_session(${token})`));
  if (!row) return null;
  return {
    userId: row.user_id,
    sessionId: row.session_id,
    email: row.email,
    emailVerified: row.email_verified === true,
    role: row.role,
    stepUpAt: row.step_up_at === null ? null : new Date(row.step_up_at),
  };
}

/**
 * Owner bootstrap (S2.3): the first verified sign-in whose email equals `OWNER_EMAIL` becomes the owner. Returns false
 * when the email does not match or an owner already exists. A SECURITY DEFINER function does it (migration 0002).
 */
export async function bootstrapOwner(db: Db, userId: string, ownerEmail: string): Promise<boolean> {
  const [row] = rowsOf<{ app_bootstrap_owner: boolean }>(await db.execute(sql`select public.app_bootstrap_owner(${userId}, ${ownerEmail})`));
  return row?.app_bootstrap_owner === true;
}

/** Admin or student role changes (owner only; the policy `app_user_update` enforces it too). */
export function setRoleQuery(db: Db, userId: string, role: "student" | "admin") {
  return db.update(appUser).set({ role }).where(eq(appUser.id, userId)).returning({ id: appUser.id });
}
