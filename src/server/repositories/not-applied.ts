import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * The "Not applied yet" list (PRD_4 F27, FR-38; architecture 23.6). Students who finished onboarding and have not applied: a profile whose
 * `lead_id` is null. It reads profiles only (no join to leads), so it cannot change a lead count, the response clock or duplicate detection,
 * and one statement answers the whole screen. It runs as the caller, so row level security (`student_profile_select`, migration 0013: the
 * person's own row, or any row for staff) is the second lock beside the facade's staff check.
 */

/** How many profiles one call returns. The rest are counted in `total` so the screen can say so. */
export const NOT_APPLIED_LIMIT = 100;

export interface NotAppliedRow {
  userId: string;
  /** The applicant's name; the endpoint reduces it to a first name and an initial before it leaves the server. */
  applicantName: string;
  country: string;
  courseFields: string[];
  onboardedAt: Date;
  /** The number the profile gave for contact (the student's own, or the parent's). Staff may see it. */
  whatsappE164: string;
}

export async function listNotApplied(db: Db, actor: Actor, limit: number = NOT_APPLIED_LIMIT): Promise<{ rows: NotAppliedRow[]; total: number }> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select sp.user_id, sp.applicant_name, sp.applicant_country, sp.course_fields, sp.onboarded_at, sp.contact_whatsapp_e164,
             count(*) over ()::int as total
        from student_profile sp
       where sp.lead_id is null
       order by sp.onboarded_at desc, sp.user_id
       limit ${limit}`),
  );
  const found = rowsOf<{ user_id: string; applicant_name: string; applicant_country: string; course_fields: string[]; onboarded_at: string | Date; contact_whatsapp_e164: string; total: number }>(result);
  return {
    rows: found.map((row) => ({
      userId: row.user_id,
      applicantName: row.applicant_name,
      country: row.applicant_country,
      courseFields: row.course_fields,
      onboardedAt: new Date(row.onboarded_at),
      whatsappE164: row.contact_whatsapp_e164,
    })),
    total: found[0] ? Number(found[0].total) : 0,
  };
}
