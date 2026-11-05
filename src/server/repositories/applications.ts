import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";
import { pgArray } from "./lead-intake";

/**
 * The application (architecture 23.2, 23.3, ADR-059; S15.3). The write is one database function, `app_apply_from_profile` (migration 0020):
 * it reads the applicant's details from the caller's own profile, makes the lead through the same function every lead uses, makes it the
 * caller's own, links it from the profile and writes an audit row, in a single transaction. The caller is read from the row level security
 * context, never from an argument, so one person cannot apply as another, and the function refuses a second application for the account.
 */

export interface NewApplication {
  id: string;
  idempotencyKey: string;
  payloadHash: string;
  /** Candidate references in order of preference; the first is the one the device made. */
  refs: readonly string[];
  clientRef: string;
  locale: string;
  clientCreatedAt: Date;
  receivedAt: Date;
  slaDueAt: Date;
  slaHoursApplied: number;
  /** In rank order: the first is the first choice. */
  programmeIds: readonly string[];
  /** Leads allowed per WhatsApp number in 24 hours. */
  numberLimit: number;
}

export type ApplicationOutcome =
  | { kind: "created" | "existing"; id: string; ref: string; storedHash: string }
  | { kind: "already_applied"; ref: string }
  | { kind: "profile_required" | "not_allowed" | "number_limited" | "unknown_programme" | "ref_exhausted" };

interface OutcomeRow {
  out_outcome: string;
  out_lead_id: string | null;
  out_lead_ref: string | null;
  out_stored_hash: string | null;
}

export async function insertApplication(db: Db, actor: Actor, row: NewApplication): Promise<ApplicationOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`select * from public.app_apply_from_profile(
      ${row.id}::uuid, ${row.idempotencyKey}::uuid, ${row.payloadHash}, ${pgArray(row.refs)}::text[], ${row.clientRef}, ${row.locale},
      ${row.clientCreatedAt.toISOString()}::timestamptz, ${row.receivedAt.toISOString()}::timestamptz, ${row.slaDueAt.toISOString()}::timestamptz,
      ${row.slaHoursApplied}::integer, ${pgArray(row.programmeIds)}::uuid[], ${row.numberLimit}::integer
    )`),
  );
  const [out] = rowsOf<OutcomeRow>(result);
  if (!out) throw new Error("app_apply_from_profile returned no row");
  if ((out.out_outcome === "created" || out.out_outcome === "existing") && out.out_lead_id && out.out_lead_ref && out.out_stored_hash) {
    return { kind: out.out_outcome, id: out.out_lead_id, ref: out.out_lead_ref, storedHash: out.out_stored_hash };
  }
  if (out.out_outcome === "already_applied" && out.out_lead_ref) return { kind: "already_applied", ref: out.out_lead_ref };
  if (
    out.out_outcome === "profile_required" ||
    out.out_outcome === "not_allowed" ||
    out.out_outcome === "number_limited" ||
    out.out_outcome === "unknown_programme" ||
    out.out_outcome === "ref_exhausted"
  ) {
    return { kind: out.out_outcome };
  }
  throw new Error(`unexpected app_apply_from_profile outcome: ${out.out_outcome}`);
}
