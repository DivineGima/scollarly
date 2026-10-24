import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { uuidv7 } from "@/lib/uuid";
import { runAs } from "./as-actor";

/**
 * The audit log (architecture 7.1, S2.7). Append-only: the runtime role has INSERT and SELECT only, and only the owner can
 * read. `meta` holds ids and changed field names, never personal data.
 *
 * A repository function that changes data adds `auditEntry(...)` to the SAME `runAs` call, so the change and its audit
 * row commit together or not at all. The query has no RETURNING on purpose: an admin may insert audit rows but not read them.
 */

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

export function auditEntry(db: Db, actor: Pick<Actor, "userId">, entry: AuditEntry) {
  return db.insert(auditLog).values({
    id: uuidv7(),
    actorId: actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    meta: entry.meta ?? {},
  });
}

/** For an event that changes nothing else (a 2FA enrolment, new recovery codes). */
export async function writeAudit(db: Db, actor: Actor, entry: AuditEntry): Promise<void> {
  await runAs(db, actor, auditEntry(db, actor, entry));
}

export interface AuditFilter {
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  /** Keyset cursor: the id of the last row of the previous page. Postgres compares against that row's own timestamp, which has microseconds a JavaScript Date would lose. */
  before?: { id: string };
  limit?: number;
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  meta: Record<string, unknown>;
  at: Date;
}

export const AUDIT_PAGE_SIZE = 50;

/** Newest first. Owner only (policy `audit_log_read`): any other caller gets an empty list. */
export async function listAudit(db: Db, actor: Actor, filter: AuditFilter = {}): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? AUDIT_PAGE_SIZE), 1), 200);
  const conditions = [
    filter.actorId ? eq(auditLog.actorId, filter.actorId) : undefined,
    filter.action ? eq(auditLog.action, filter.action) : undefined,
    filter.from ? gte(auditLog.at, filter.from) : undefined,
    filter.to ? lt(auditLog.at, filter.to) : undefined,
    filter.before ? sql`(${auditLog.at}, ${auditLog.id}) < (select a.at, a.id from audit_log a where a.id = ${filter.before.id}::uuid)` : undefined,
  ];
  const [rows] = await runAs(
    db,
    actor,
    db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit),
  );
  return rows;
}

/** The distinct actions on record, for the filter. */
export async function listAuditActions(db: Db, actor: Actor): Promise<string[]> {
  const [rows] = await runAs(db, actor, db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(auditLog.action));
  return rows.map((r) => r.action);
}
