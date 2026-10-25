import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * Student link requests (architecture 9.6, S5.5, B4). Reading them needs the claiming account's name and email, which live
 * in Neon Auth's tables, and deciding one touches the claim, the lead, the activity and the audit log together, so both are
 * database functions (migration 0006) that check for staff themselves. The row level security context is still set by
 * `runAs`, so the function reads the caller from the same place the policies do.
 */

export interface ClaimRow {
  claimId: string;
  /** How the student found the lead: by `ref` or by `number` (an `auto` claim is already approved). */
  method: string;
  createdAt: Date;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  emailVerified: boolean;
  leadId: string;
  leadRef: string;
  leadName: string | null;
  leadCountry: string;
  /** The claiming account's verified email equals the lead's email, so "Email matches the lead" will be accepted. */
  emailMatches: boolean;
  /** The lead already belongs to a different account, so it cannot be approved. */
  linkedToOther: boolean;
}

export async function listPendingClaims(db: Db, actor: Actor): Promise<ClaimRow[]> {
  const [result] = await runAs(db, actor, db.execute(sql`select * from public.app_list_claims()`));
  return rowsOf<{
    claim_id: string;
    method: string;
    created_at: string | Date;
    user_id: string;
    user_name: string | null;
    user_email: string | null;
    email_verified: boolean | null;
    lead_id: string;
    lead_ref: string;
    lead_name: string | null;
    lead_country: string;
    lead_email_matches: boolean | null;
    lead_linked_to_other: boolean | null;
  }>(result).map((r) => ({
    claimId: r.claim_id,
    method: r.method,
    createdAt: new Date(r.created_at),
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    emailVerified: r.email_verified === true,
    leadId: r.lead_id,
    leadRef: r.lead_ref,
    leadName: r.lead_name,
    leadCountry: r.lead_country,
    emailMatches: r.lead_email_matches === true,
    linkedToOther: r.lead_linked_to_other === true,
  }));
}

export type DecideClaimOutcome = "approved" | "rejected" | "not_found" | "not_pending" | "method_required" | "email_mismatch" | "lead_unavailable" | "already_linked";

export type ClaimDecision = { decision: "approve"; verificationMethod: "email_match" | "whatsapp_confirmed" } | { decision: "reject"; reason: string };

/** Approving without a verification method is refused here and again by a CHECK constraint on the table. */
export async function decideClaim(db: Db, actor: Actor, claimId: string, input: ClaimDecision): Promise<{ outcome: DecideClaimOutcome; leadId: string | null }> {
  // A missing value must reach the function as NULL (it then answers `method_required`), never as an empty SQL argument.
  const method = (input.decision === "approve" ? input.verificationMethod : null) ?? null;
  const reason = (input.decision === "reject" ? input.reason : null) ?? null;
  const [result] = await runAs(db, actor, db.execute(sql`select * from public.app_decide_claim(${claimId}::uuid, ${input.decision}, ${method}, ${reason})`));
  const row = rowsOf<{ out_outcome: DecideClaimOutcome; out_lead_id: string | null }>(result)[0];
  return { outcome: row?.out_outcome ?? "not_found", leadId: row?.out_lead_id ?? null };
}
