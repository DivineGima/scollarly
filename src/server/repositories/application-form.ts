import { sql } from "drizzle-orm";
import type { FormBody } from "@/modules/application-form/schema";
import type { ProfileFormRow } from "@/modules/application-form/service";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * The step-2 form (S17.2; FR-43). It lives on the student's own profile row, which only the student writes (policy `student_profile_update`);
 * staff read it through the same policy that scopes a manager to their students. Nothing here is logged.
 */

export interface FormState {
  profile: ProfileFormRow;
  /** The application the form belongs to. Null before the student has applied. */
  application: { id: string; ref: string; stageCode: string; status: string } | null;
  /** Whether the application's university asks for the passport. */
  passportRequired: boolean;
}

interface Raw {
  applicant_name: string;
  contact_whatsapp_e164: string;
  course_fields: string[];
  intake_year: number;
  applicant_country: string;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  residence_state: string | null;
  city: string | null;
  address: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  mother_name: string | null;
  mother_phone: string | null;
  passport_number: string | null;
  form_completed_at: string | Date | null;
  lead_id: string | null;
  lead_ref: string | null;
  stage_code: string | null;
  lead_status: string | null;
  passport_required: boolean | null;
}

/** The caller's own profile and application, or null when they have no profile. */
export async function readFormState(db: Db, actor: Actor): Promise<FormState | null> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select sp.applicant_name, sp.contact_whatsapp_e164, sp.course_fields, sp.intake_year, sp.applicant_country,
             sp.date_of_birth::text as date_of_birth, sp.gender, sp.nationality, sp.residence_state, sp.city, sp.address,
             sp.guardian_name, sp.guardian_phone, sp.mother_name, sp.mother_phone, sp.passport_number, sp.form_completed_at,
             l.id as lead_id, l.ref as lead_ref, l.stage_code, l.status as lead_status,
             case when l.id is null then false else public.app_lead_passport_required(l.id) end as passport_required
        from student_profile sp
        left join lead l on l.id = sp.lead_id and l.anonymised_at is null and l.merged_into_id is null
       where sp.user_id = ${actor.userId}`),
  );
  const r = rowsOf<Raw>(result)[0];
  if (!r) return null;
  return {
    profile: {
      applicantName: r.applicant_name,
      contactWhatsapp: r.contact_whatsapp_e164,
      courseFields: r.course_fields,
      intakeYear: r.intake_year,
      applicantCountry: r.applicant_country,
      dateOfBirth: r.date_of_birth,
      gender: r.gender,
      nationality: r.nationality,
      residenceState: r.residence_state,
      city: r.city,
      address: r.address,
      guardianName: r.guardian_name,
      guardianPhone: r.guardian_phone,
      motherName: r.mother_name,
      motherPhone: r.mother_phone,
      passportNumber: r.passport_number,
      formCompletedAt: r.form_completed_at ? new Date(r.form_completed_at).toISOString() : null,
    },
    application: r.lead_id && r.lead_ref && r.stage_code && r.lead_status ? { id: r.lead_id, ref: r.lead_ref, stageCode: r.stage_code, status: r.lead_status } : null,
    passportRequired: r.passport_required === true,
  };
}

/** Saves the form on the caller's own profile. `passport` is what to store (null clears it). False when there is no profile row to update. */
export async function saveForm(db: Db, actor: Actor, form: FormBody, passport: string | null): Promise<boolean> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      update student_profile
         set date_of_birth = ${form.dateOfBirth}::date, gender = ${form.gender}, nationality = ${form.nationality},
             residence_state = ${form.residenceState}, city = ${form.city}, address = ${form.address},
             guardian_name = ${form.guardianName}, guardian_phone = ${form.guardianPhone},
             mother_name = ${form.motherName}, mother_phone = ${form.motherPhone},
             passport_number = ${passport}, form_completed_at = now(), updated_at = now()
       where user_id = ${actor.userId}
       returning user_id`),
  );
  return rowsOf(result).length > 0;
}
