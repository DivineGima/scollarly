import { sql, type SQL } from "drizzle-orm";

/**
 * Whether a lead belongs to a university: the page it came from named it (`source.university_id`, public university pages before version 4), or one of
 * the programmes it chose is that university's (`lead_programme_pref`, every application since version 4). The Leads list and the Insights screens use
 * this one rule, so a university filter means the same on both. The caller passes the two columns as SQL, because the list is written with Drizzle
 * columns and the Insights queries use the alias `l`.
 */
export function leadInUniversity(leadId: SQL, source: SQL, universityId: string): SQL {
  return sql`(${source}->>'university_id' = ${universityId} or exists (
    select 1 from lead_programme_pref pp join programme p on p.id = pp.programme_id
     where pp.lead_id = ${leadId} and p.university_id = ${universityId}::uuid))`;
}
