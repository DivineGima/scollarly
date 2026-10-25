import { desc, eq, getTableColumns } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { lead } from "@/server/db/schema";
import { runAs } from "./as-actor";

/**
 * Lead reads (architecture 7.2). Staff see every lead; a student sees only a lead linked to their own account; nobody
 * else sees any (policy `lead_read`). Creating a lead is a database function added with `POST /api/v1/leads` (S4.4), and
 * the stage, assignment and reply operations arrive with the admin screens (Stage 5).
 */

const { payloadHash: _payloadHash, idempotencyKey: _idempotencyKey, ...publicColumns } = getTableColumns(lead);
/** The idempotency key and payload hash belong to the intake path and are never returned to a screen. */
export const leadColumns = publicColumns;

export type LeadRow = Omit<typeof lead.$inferSelect, "payloadHash" | "idempotencyKey">;

export async function findLeadById(db: Db, actor: Actor, id: string): Promise<LeadRow | null> {
  const [rows] = await runAs(db, actor, db.select(leadColumns).from(lead).where(eq(lead.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function findLeadByRef(db: Db, actor: Actor, ref: string): Promise<LeadRow | null> {
  const [rows] = await runAs(db, actor, db.select(leadColumns).from(lead).where(eq(lead.ref, ref)).limit(1));
  return rows[0] ?? null;
}

/** Newest first. `limit` is capped so a screen can never ask for the whole table. */
export async function listLeads(db: Db, actor: Actor, options: { limit?: number; offset?: number } = {}): Promise<LeadRow[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const [rows] = await runAs(db, actor, db.select(leadColumns).from(lead).orderBy(desc(lead.receivedAt)).limit(limit).offset(offset));
  return rows;
}

// Creating a lead lives in its own file (see lead-intake.ts); these names are re-exported so imports keep working.
export { insertLead, type InsertLeadOutcome, type NewLead } from "./lead-intake";
