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

export type AcceptInviteResult = "accepted" | "wrong_email" | "invalid";

/** B0 step 2: the role becomes admin only for the invited, Google-verified email (migration 0004). The session token identifies the user. */
export async function acceptInvite(db: Db, sessionToken: string, inviteHash: string): Promise<AcceptInviteResult> {
  const [row] = rowsOf<{ app_accept_invite: string }>(await db.execute(sql`select public.app_accept_invite(${sessionToken}, ${inviteHash})`));
  const value = row?.app_accept_invite;
  return value === "accepted" || value === "wrong_email" ? value : "invalid";
}

export type InviteStatus = "open" | "used" | "revoked" | "expired";

/** What an invite link says to a visitor who is not signed in. Null for an unknown link. */
export async function inviteStatus(db: Db, inviteHash: string): Promise<{ email: string; status: InviteStatus } | null> {
  const [row] = rowsOf<{ email: string; status: InviteStatus }>(await db.execute(sql`select * from public.app_invite_status(${inviteHash})`));
  return row ?? null;
}

/** F13: blanks the visitor's IP address and browser string that Neon Auth keeps on a session (migration 0004). With no token, every session. */
export async function scrubSessionPii(db: Db, sessionToken: string | null = null): Promise<number> {
  const [row] = rowsOf<{ app_scrub_session_pii: number }>(await db.execute(sql`select public.app_scrub_session_pii(${sessionToken})`));
  return row?.app_scrub_session_pii ?? 0;
}

export interface Profile {
  name: string;
  email: string;
}

export async function profileOf(db: Db, sessionToken: string): Promise<Profile | null> {
  const [row] = rowsOf<Profile>(await db.execute(sql`select * from public.app_profile(${sessionToken})`));
  return row ?? null;
}

export async function setProfileName(db: Db, sessionToken: string, name: string): Promise<boolean> {
  const [row] = rowsOf<{ app_set_profile_name: boolean }>(await db.execute(sql`select public.app_set_profile_name(${sessionToken}, ${name})`));
  return row?.app_set_profile_name === true;
}

export interface SessionSummary {
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export async function mySessions(db: Db, sessionToken: string): Promise<SessionSummary[]> {
  const rows = rowsOf<{ created_at: string | Date; expires_at: string | Date; is_current: boolean }>(
    await db.execute(sql`select * from public.app_my_sessions(${sessionToken})`),
  );
  return rows.map((r) => ({ createdAt: new Date(r.created_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString(), isCurrent: r.is_current === true }));
}

/** Ends every other session of the same user. Sessions are expired, not deleted. Returns how many ended. */
export async function revokeOtherSessions(db: Db, sessionToken: string): Promise<number> {
  const [row] = rowsOf<{ app_revoke_other_sessions: number }>(await db.execute(sql`select public.app_revoke_other_sessions(${sessionToken})`));
  return row?.app_revoke_other_sessions ?? 0;
}

/** Admin or student role changes (owner only; the policy `app_user_update` enforces it too). */
export function setRoleQuery(db: Db, userId: string, role: "student" | "admin") {
  return db.update(appUser).set({ role }).where(eq(appUser.id, userId)).returning({ id: appUser.id });
}
