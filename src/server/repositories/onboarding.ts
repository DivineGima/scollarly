import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";
import { pgArray } from "./lead-intake";

/**
 * Onboarding (architecture 21.6, ADR-043; S13.3). The write is one database function, `app_complete_onboarding` (migration 0014): it
 * creates the lead of kind `onboarding`, links it to the caller, stores the profile and an audit row in a single transaction, and a
 * replay of the same idempotency key answers with the same lead. The caller is read from the row level security context, never from an
 * argument, so one person cannot onboard as another.
 */

export interface NewOnboarding {
  id: string;
  idempotencyKey: string;
  payloadHash: string;
  /** Candidate references in order of preference; the first is the one the device made. */
  refs: readonly string[];
  clientRef: string;
  /** The applicant: the student, or the child. */
  name: string;
  /** The contact's WhatsApp number in E.164: the student's own, or the parent's. */
  whatsappE164: string;
  countryCode: string;
  qualificationType: string;
  results: readonly { subject: string; grade: string }[];
  source: Record<string, unknown>;
  locale: string;
  consentNoticeVersion: string;
  consentAt: Date;
  clientCreatedAt: Date;
  receivedAt: Date;
  slaDueAt: Date;
  slaHoursApplied: number;
  /** Leads allowed per WhatsApp number in 24 hours. */
  numberLimit: number;
  relationship: string;
  contactName: string;
  level: string;
  courseFields: readonly string[];
  intakeYear: number;
}

export type OnboardingOutcome =
  | { kind: "created" | "existing"; id: string; ref: string; storedHash: string }
  | { kind: "already_onboarded" | "not_allowed" | "number_limited" | "ref_exhausted" };

interface OutcomeRow {
  out_outcome: string;
  out_lead_id: string | null;
  out_lead_ref: string | null;
  out_stored_hash: string | null;
}

export async function completeOnboarding(db: Db, actor: Actor, row: NewOnboarding): Promise<OnboardingOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`select * from public.app_complete_onboarding(
      ${row.id}::uuid, ${row.idempotencyKey}::uuid, ${row.payloadHash}, ${pgArray(row.refs)}::text[], ${row.clientRef},
      ${row.name}, ${row.whatsappE164}, ${row.countryCode}, ${row.qualificationType}, ${JSON.stringify(row.results)}::jsonb,
      ${JSON.stringify(row.source)}::jsonb, ${row.locale}, ${row.consentNoticeVersion}, ${row.consentAt.toISOString()}::timestamptz,
      ${row.clientCreatedAt.toISOString()}::timestamptz, ${row.receivedAt.toISOString()}::timestamptz, ${row.slaDueAt.toISOString()}::timestamptz,
      ${row.slaHoursApplied}::integer, ${row.numberLimit}::integer, ${row.relationship}, ${row.contactName}, ${row.level},
      ${pgArray(row.courseFields)}::text[], ${row.intakeYear}::smallint
    )`),
  );
  const [out] = rowsOf<OutcomeRow>(result);
  if (!out) throw new Error("app_complete_onboarding returned no row");
  if ((out.out_outcome === "created" || out.out_outcome === "existing") && out.out_lead_id && out.out_lead_ref && out.out_stored_hash) {
    return { kind: out.out_outcome, id: out.out_lead_id, ref: out.out_lead_ref, storedHash: out.out_stored_hash };
  }
  if (out.out_outcome === "already_onboarded" || out.out_outcome === "not_allowed" || out.out_outcome === "number_limited" || out.out_outcome === "ref_exhausted") {
    return { kind: out.out_outcome };
  }
  throw new Error(`unexpected app_complete_onboarding outcome: ${out.out_outcome}`);
}

export interface OnboardingState {
  onboarded: boolean;
  relationship: "student" | "parent" | null;
  /** The reference of the lead the onboarding made, for "your reference is ...". */
  ref: string | null;
}

/** Whether the caller has finished onboarding. Row level security lets a person read only their own profile. */
export async function onboardingStateOf(db: Db, actor: Actor): Promise<OnboardingState> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select sp.relationship, l.ref
        from student_profile sp
        left join lead l on l.id = sp.lead_id
       where sp.user_id = ${actor.userId}`),
  );
  const row = rowsOf<{ relationship: string; ref: string | null }>(result)[0];
  if (!row) return { onboarded: false, relationship: null, ref: null };
  return { onboarded: true, relationship: row.relationship === "parent" ? "parent" : "student", ref: row.ref };
}
