import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * The student's home and preferences (architecture 21.4; S13.4). Everything is read as the caller, so row level security lets a
 * student read only their own profile and their own lead, whatever is asked for here (the Stage 8 rule, still true).
 */

export interface MyPreferences {
  onboarded: boolean;
  relationship: "student" | "parent" | null;
  /** The name the screen greets: the student's own, or the parent's. Null when the person has not onboarded. */
  contactName: string | null;
  courseFields: string[];
  level: string | null;
  intakeYear: number | null;
}

interface ProfileRow {
  relationship: string;
  applicant_name: string;
  contact_name: string;
  course_fields: string[];
  level: string;
  intake_year: number;
}

function preferencesFrom(row: ProfileRow | undefined): MyPreferences {
  if (!row) return { onboarded: false, relationship: null, contactName: null, courseFields: [], level: null, intakeYear: null };
  const relationship = row.relationship === "parent" ? "parent" : "student";
  return {
    onboarded: true,
    relationship,
    contactName: relationship === "parent" ? row.contact_name : row.applicant_name,
    courseFields: row.course_fields,
    level: row.level,
    intakeYear: row.intake_year,
  };
}

const profileQuery = (db: Db, actor: Actor) =>
  db.execute(sql`select relationship, applicant_name, contact_name, course_fields, level, intake_year from student_profile where user_id = ${actor.userId}`);

/** `GET me/preferences`: the answers only, one query. The Universities screen orders the public list with them, in the browser. */
export async function preferencesOf(db: Db, actor: Actor): Promise<MyPreferences> {
  const [profile] = await runAs(db, actor, profileQuery(db, actor));
  return preferencesFrom(rowsOf<ProfileRow>(profile)[0]);
}

export interface MyHome extends MyPreferences {
  lead: { ref: string; stageCode: string; updatedAt: Date } | null;
  stages: { code: string; position: number }[];
  whatsappE164: string | null;
}

/** `GET me/home`: the answers, the newest own lead, the six stage names' order and the WhatsApp setting, in one round trip. */
export async function homeOf(db: Db, actor: Actor): Promise<MyHome> {
  const [profile, leads, stages, setting] = await runAs(
    db,
    actor,
    profileQuery(db, actor),
    db.execute(sql`
      select l.ref, l.stage_code, l.updated_at
        from lead l
       where l.user_id = ${actor.userId} and l.anonymised_at is null and l.merged_into_id is null
       order by l.received_at desc limit 1`),
    db.execute(sql`select code, position from pipeline_stage order by position`),
    db.execute(sql`select value from site_setting where key = 'whatsapp_number_e164'`),
  );
  const lead = rowsOf<{ ref: string; stage_code: string; updated_at: string | Date }>(leads)[0];
  const number = rowsOf<{ value: unknown }>(setting)[0]?.value;
  return {
    ...preferencesFrom(rowsOf<ProfileRow>(profile)[0]),
    lead: lead ? { ref: lead.ref, stageCode: lead.stage_code, updatedAt: new Date(lead.updated_at) } : null,
    stages: rowsOf<{ code: string; position: number }>(stages),
    whatsappE164: typeof number === "string" ? number : null,
  };
}
