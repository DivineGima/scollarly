import { sql } from "drizzle-orm";
import type { ResolvedSession } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";

/**
 * The session lookup, in its own file because it needs no table definition (it calls a database function). The lead endpoint checks
 * for an account with it (PRD_3 F20), and the Worker loads whatever a file imports on the first request of every fresh instance, so it
 * must not drag the whole schema in with it (see `tests/unit/worker-startup.test.ts`). `identity.ts` re-exports `resolveSession`.
 */

interface SessionRow {
  user_id: string;
  session_id: string;
  email: string;
  email_verified: boolean;
  role: string;
  step_up_at: string | Date | null;
  account_confirmed: boolean;
}

/**
 * The single query the auth facade runs per request (ADR-034). The SECURITY DEFINER function looks the Neon Auth
 * session up, creates the `app_user` row on the first sign-in (idempotent), and returns the role and the step-up
 * time and whether the account is confirmed (`app_resolve_session_v2`, ADR-042). Returns null for an unknown, expired or banned session.
 */
export async function resolveSession(db: Db, token: string): Promise<ResolvedSession | null> {
  const [row] = rowsOf<SessionRow>(await db.execute(sql`select * from public.app_resolve_session_v2(${token})`));
  if (!row) return null;
  return {
    userId: row.user_id,
    sessionId: row.session_id,
    email: row.email,
    emailVerified: row.email_verified === true,
    role: row.role,
    stepUpAt: row.step_up_at === null ? null : new Date(row.step_up_at),
    accountConfirmed: row.account_confirmed === true,
  };
}
