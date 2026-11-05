import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";
import { pgArray } from "./lead-intake";

/**
 * Onboarding (architecture 21.6, 23.2, ADR-043, ADR-062; S15.2). The write is one database function, `app_complete_profile` (migration 0019):
 * it stores the profile and an audit row in a single transaction and makes NO lead; the application is a separate act (PRD_4 F24). The
 * caller is read from the row level security context, never from an argument, so one person cannot onboard as another, and a replay
 * (a retry, a double tap, a second device) finds the profile already there and writes nothing.
 */

export interface NewProfile {
  /** The applicant: the student, or the child. */
  name: string;
  /** The contact's WhatsApp number in E.164: the student's own, or the parent's. */
  whatsappE164: string;
  countryCode: string;
  qualificationType: string;
  results: readonly { subject: string; grade: string }[];
  consentNoticeVersion: string;
  consentAt: Date;
  relationship: string;
  contactName: string;
  level: string;
  courseFields: readonly string[];
  intakeYear: number;
}

export type ProfileOutcome = "created" | "already_onboarded" | "not_allowed";

export async function completeProfile(db: Db, actor: Actor, row: NewProfile): Promise<ProfileOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`select * from public.app_complete_profile(
      ${row.name}, ${row.whatsappE164}, ${row.countryCode}, ${row.qualificationType}, ${JSON.stringify(row.results)}::jsonb,
      ${row.consentNoticeVersion}, ${row.consentAt.toISOString()}::timestamptz, ${row.relationship}, ${row.contactName}, ${row.level},
      ${pgArray(row.courseFields)}::text[], ${row.intakeYear}::smallint
    )`),
  );
  const [out] = rowsOf<{ out_outcome: string }>(result);
  if (!out) throw new Error("app_complete_profile returned no row");
  if (out.out_outcome === "created" || out.out_outcome === "already_onboarded" || out.out_outcome === "not_allowed") return out.out_outcome;
  throw new Error(`unexpected app_complete_profile outcome: ${out.out_outcome}`);
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
