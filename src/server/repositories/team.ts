import { and, asc, isNull, sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { adminInvite } from "@/server/db/schema";
import { runAs } from "./as-actor";
import { auditEntry } from "./audit";

/**
 * Team and invites (architecture 9.4, S2.5). The owner is the only caller; the policies on `admin_invite` say so too.
 * Every change commits together with its audit row.
 */

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: "admin" | "owner";
  leadsHeld: number;
  since: Date;
}

/** Staff with names and emails, which live in Neon Auth's tables, so a SECURITY DEFINER function reads them (migration 0004). */
export async function listTeam(db: Db, actor: Actor): Promise<TeamMember[]> {
  const [result] = await runAs(db, actor, teamQuery(db));
  return teamMembersOf(result);
}

/** The statement behind `listTeam`, for a screen that runs it together with its other reads in one round trip. */
export const teamQuery = (db: Db) => db.execute(sql`select * from public.app_list_team()`);

export function teamMembersOf(result: unknown): TeamMember[] {
  return rowsOf<{ user_id: string; email: string; name: string; role: "admin" | "owner"; leads_held: string | number; since: string | Date }>(result).map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
    role: r.role,
    leadsHeld: Number(r.leads_held),
    since: new Date(r.since),
  }));
}

export interface OpenInvite {
  id: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: string;
}

/** Invites not yet used or revoked, expired ones included (the screen shows them as expired). */
export async function listOpenInvites(db: Db, actor: Actor): Promise<OpenInvite[]> {
  const [rows] = await runAs(
    db,
    actor,
    db
      .select({ id: adminInvite.id, email: adminInvite.email, createdAt: adminInvite.createdAt, expiresAt: adminInvite.expiresAt, invitedBy: adminInvite.invitedBy })
      .from(adminInvite)
      .where(and(isNull(adminInvite.acceptedAt), isNull(adminInvite.revokedAt)))
      .orderBy(asc(adminInvite.createdAt)),
  );
  return rows;
}

export interface NewInvite {
  id: string;
  /** Lower case. */
  email: string;
  /** SHA-256 hex of the token. The token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Creates an invite. Any invite still open for the same email is revoked first, in the same transaction, so "Resend" is the
 * same call and a person never holds two working links. The unique index `admin_invite_one_open_per_email` turns two
 * simultaneous calls into one winner and one error (23505), which the endpoint reports as a conflict.
 */
export async function createInvite(db: Db, actor: Actor, invite: NewInvite): Promise<void> {
  await runAs(
    db,
    actor,
    db
      .update(adminInvite)
      .set({ revokedAt: sql`now()` })
      .where(and(sql`lower(${adminInvite.email}) = ${invite.email}`, isNull(adminInvite.acceptedAt), isNull(adminInvite.revokedAt))),
    db.insert(adminInvite).values({ id: invite.id, email: invite.email, tokenHash: invite.tokenHash, invitedBy: actor.userId, expiresAt: invite.expiresAt }),
    auditEntry(db, actor, { action: "team.invite", entityType: "admin_invite", entityId: invite.id }),
  );
}

/** Revokes an open invite. Returns false when there was nothing to revoke (already used, revoked or unknown); no audit row then. */
export async function revokeInvite(db: Db, actor: Actor, id: string, auditId: string): Promise<boolean> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with revoked as (
        update admin_invite set revoked_at = now()
         where id = ${id}::uuid and accepted_at is null and revoked_at is null
        returning id
      ), logged as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select ${auditId}::uuid, ${actor.userId}, 'team.revokeInvite', 'admin_invite', revoked.id::text, '{}'::jsonb from revoked
      )
      select count(*)::int as revoked from revoked
    `),
  );
  return (rowsOf<{ revoked: number }>(result)[0]?.revoked ?? 0) > 0;
}

/**
 * Removes an admin: role to student, sessions ended, leads back to the unassigned pool, audit row, in one transaction
 * (migration 0004). Returns the number of leads released, or null when the user is not an admin (owner included).
 */
export async function removeAdmin(db: Db, actor: Actor, userId: string): Promise<number | null> {
  const [result] = await runAs(db, actor, db.execute(sql`select public.app_remove_admin(${userId}) as released`));
  const released = rowsOf<{ released: number }>(result)[0]?.released;
  return released === undefined || released < 0 ? null : released;
}
