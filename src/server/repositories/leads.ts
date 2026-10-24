import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
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

/** A PostgreSQL array literal for values already validated as references or UUIDs, so no driver has to guess how to send an array. */
function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/[\\"]/g, "\\$&")}"`).join(",")}}`;
}

export interface NewLead {
  id: string;
  idempotencyKey: string;
  payloadHash: string;
  /** Candidate references in order of preference; the first is the one the device made. */
  refs: readonly string[];
  clientRef: string;
  name: string;
  whatsappE164: string;
  countryCode: string;
  email: string | null;
  intakeKind: "full" | "quick";
  qualificationType: string | null;
  results: readonly { subject: string; grade: string }[];
  source: Record<string, unknown>;
  locale: string;
  consentNoticeVersion: string;
  consentAt: Date;
  clientCreatedAt: Date | null;
  receivedAt: Date;
  slaDueAt: Date;
  slaHoursApplied: number;
  programmeIds: readonly string[];
  /** Leads allowed per WhatsApp number in 24 hours. */
  numberLimit: number;
}

export type InsertLeadOutcome =
  | { kind: "created" | "existing"; id: string; ref: string; storedHash: string }
  | { kind: "number_limited" | "unknown_programme" | "ref_exhausted" };

/**
 * Stores a lead idempotently in one call (`app_create_lead`, migration 0005, architecture 8.2). It is a database function
 * so an anonymous visitor needs no right to read or write leads. The caller compares `storedHash` with its own payload hash
 * to tell a safe replay (same key, same payload) from a reused key (409).
 */
export async function insertLead(db: Db, row: NewLead): Promise<InsertLeadOutcome> {
  const iso = (date: Date | null) => (date ? date.toISOString() : null);
  const [result] = rowsOf<{ out_outcome: string; out_lead_id: string | null; out_lead_ref: string | null; out_stored_hash: string | null }>(
    await db.execute(sql`select * from public.app_create_lead(
      ${row.id}::uuid, ${row.idempotencyKey}::uuid, ${row.payloadHash}, ${pgArray(row.refs)}::text[],
      ${row.clientRef}, ${row.name}, ${row.whatsappE164}, ${row.countryCode}, ${row.email}, ${row.intakeKind},
      ${row.qualificationType}, ${JSON.stringify(row.results)}::jsonb, ${JSON.stringify(row.source)}::jsonb, ${row.locale},
      ${row.consentNoticeVersion}, ${iso(row.consentAt)}::timestamptz, ${iso(row.clientCreatedAt)}::timestamptz,
      ${iso(row.receivedAt)}::timestamptz, ${iso(row.slaDueAt)}::timestamptz, ${row.slaHoursApplied}::integer,
      ${pgArray(row.programmeIds)}::uuid[], ${row.numberLimit}::integer
    )`),
  );
  if (!result) throw new Error("app_create_lead returned no row");
  if ((result.out_outcome === "created" || result.out_outcome === "existing") && result.out_lead_id && result.out_lead_ref && result.out_stored_hash) {
    return { kind: result.out_outcome, id: result.out_lead_id, ref: result.out_lead_ref, storedHash: result.out_stored_hash };
  }
  if (result.out_outcome === "number_limited" || result.out_outcome === "unknown_programme" || result.out_outcome === "ref_exhausted") {
    return { kind: result.out_outcome };
  }
  throw new Error(`unexpected app_create_lead outcome: ${result.out_outcome}`);
}
