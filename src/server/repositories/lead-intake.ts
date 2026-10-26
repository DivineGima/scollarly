import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";

/**
 * Lead intake (`POST /api/v1/leads`, S4.4): the one database call behind it. It lives in its own file, apart from the lead
 * reads, because it needs no table definition (it calls a database function), and the Worker loads whatever a file imports
 * on the first request of every fresh instance: with the reads in the same file, the first lead of an instance also paid for
 * loading the whole schema. `repositories/leads.ts` re-exports these names, so existing imports still work.
 */

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
export async function insertLead(db: Db, row: NewLead, sessionToken?: string | null): Promise<InsertLeadOutcome> {
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
    // S8.2: a lead made in the session of a signed-in student is linked to that account at once. It is a second, separate call and
    // only for a signed-in student, so an anonymous visitor (almost every lead) pays nothing for it; if it fails the lead is stored
    // anyway and the student can ask for the link on /me/link-application.
    if (result.out_outcome === "created" && sessionToken) {
      try {
        await db.execute(sql`select public.app_link_new_lead(${result.out_lead_id}::uuid, ${sessionToken})`);
      } catch {
        // Deliberately silent: the lead is safe, and nothing about the link is worth failing the application for.
      }
    }
    return { kind: result.out_outcome, id: result.out_lead_id, ref: result.out_lead_ref, storedHash: result.out_stored_hash };
  }
  if (result.out_outcome === "number_limited" || result.out_outcome === "unknown_programme" || result.out_outcome === "ref_exhausted") {
    return { kind: result.out_outcome };
  }
  throw new Error(`unexpected app_create_lead outcome: ${result.out_outcome}`);
}
