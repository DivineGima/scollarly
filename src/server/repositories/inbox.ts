import { sql, type SQL } from "drizzle-orm";
import { INBOX_ROW_LIMIT, INBOX_SECTIONS, LETTER_CONTACT_ACTIVITIES, sectionsFor, type InboxResult, type InboxRow, type InboxSection } from "@/modules/inbox/sections";
import { QUIET_AFTER_DAYS, UNIVERSITY_CLOCK_DAYS } from "@/modules/pipeline/steps";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * The Inbox read (architecture 24.9): ONE round trip gives the count of every section and the rows of the one asked for. It runs as the caller, so
 * row level security is the second lock: a manager's `lead` rows are the students assigned to them, a student's documents are readable only for
 * students the caller may see. Only open files count (a closed or arrived file is not work). No N+1: each section is one statement.
 */

const STUDENT_KINDS = sql`('results', 'id', 'birth_certificate', 'signature', 'passport')`;
const LETTER_KINDS = sql`('offer_letter', 'acceptance_letter')`;
// Fixed values from the constants, never from a request, so writing them into the statement is safe.
const CONTACTS = sql.raw(LETTER_CONTACT_ACTIVITIES.map((a) => `'${a}'`).join(", "));
const DAYS = (n: number) => sql.raw(`interval '${n} days'`);

/** Every section is a condition on `l` (an open, live lead) and the moment its thing began (`at`), so the counts and the rows cannot disagree. */
const SECTION: Record<InboxSection, { where: SQL; at: SQL; waiting?: SQL }> = {
  new: { where: sql`l.first_response_at is null`, at: sql`l.received_at` },
  to_review: {
    where: sql`exists (select 1 from student_document d where d.student_id = l.user_id and d.state = 'uploaded' and d.kind in ${STUDENT_KINDS})`,
    at: sql`(select min(d.created_at) from student_document d where d.student_id = l.user_id and d.state = 'uploaded' and d.kind in ${STUDENT_KINDS})`,
    waiting: sql`(select count(*)::int from student_document d where d.student_id = l.user_id and d.state = 'uploaded' and d.kind in ${STUDENT_KINDS})`,
  },
  overdue: {
    where: sql`l.stage_code = 'university_review' and l.university_submitted_at is not null and l.university_submitted_at + ${DAYS(UNIVERSITY_CLOCK_DAYS)} < now()`,
    at: sql`l.university_submitted_at + ${DAYS(UNIVERSITY_CLOCK_DAYS)}`,
  },
  letter_ready: {
    where: sql`exists (select 1 from student_document d where d.student_id = l.user_id and d.kind in ${LETTER_KINDS} and d.state in ('uploaded', 'approved')
      and d.created_at > coalesce((select max(a.created_at) from lead_activity a where a.lead_id = l.id and a.type in (${CONTACTS})), 'epoch'::timestamptz))`,
    at: sql`(select max(d.created_at) from student_document d where d.student_id = l.user_id and d.kind in ${LETTER_KINDS} and d.state in ('uploaded', 'approved'))`,
  },
  payment_proof: {
    where: sql`exists (select 1 from student_document d where d.student_id = l.user_id and d.kind = 'payment_proof' and d.state = 'uploaded')`,
    at: sql`(select min(d.created_at) from student_document d where d.student_id = l.user_id and d.kind = 'payment_proof' and d.state = 'uploaded')`,
    waiting: sql`(select count(*)::int from student_document d where d.student_id = l.user_id and d.kind = 'payment_proof' and d.state = 'uploaded')`,
  },
  quiet: { where: sql`l.last_student_activity_at < now() - ${DAYS(QUIET_AFTER_DAYS)}`, at: sql`l.last_student_activity_at` },
  unassigned: { where: sql`l.assigned_manager_id is null`, at: sql`l.received_at` },
};

const OPEN = sql`l.status = 'open' and l.merged_into_id is null and l.anonymised_at is null`;

export async function inboxFor(db: Db, actor: Actor, role: "manager" | "admin", requested: InboxSection): Promise<InboxResult> {
  const allowed = sectionsFor(role);
  const section = allowed.includes(requested) ? requested : (allowed[0] as InboxSection);
  const counts = sql.join(
    INBOX_SECTIONS.map((key) => sql`count(*) filter (where ${SECTION[key].where})::int as ${sql.raw(`"${key}"`)}`),
    sql`, `,
  );
  const spec = SECTION[section];
  const [countResult, rowResult] = await runAs(
    db,
    actor,
    db.execute(sql`select ${counts} from lead l where ${OPEN}`),
    db.execute(sql`
      select l.id::text as id, l.ref, l.name, l.stage_code, ${spec.at} as at, ${spec.waiting ?? sql`null::int`} as waiting,
             floor(extract(epoch from (now() - l.last_student_activity_at)) / 86400)::int as idle_days
        from lead l
       where ${OPEN} and ${spec.where}
       order by at asc nulls last, l.id
       limit ${INBOX_ROW_LIMIT + 1}`),
  );
  const found = rowsOf<Record<string, number>>(countResult)[0] ?? {};
  const countsByKey = Object.fromEntries(INBOX_SECTIONS.map((key) => [key, allowed.includes(key) ? Number(found[key] ?? 0) : 0])) as Record<InboxSection, number>;
  const raw = rowsOf<{ id: string; ref: string; name: string | null; stage_code: string; at: string | Date | null; waiting: number | null; idle_days: number | null }>(rowResult);
  const rows: InboxRow[] = raw.slice(0, INBOX_ROW_LIMIT).map((r) => ({
    id: r.id,
    ref: r.ref,
    name: r.name,
    stageCode: r.stage_code,
    at: new Date(r.at ?? Date.now()).toISOString(),
    waiting: r.waiting === null ? null : Number(r.waiting),
    idleDays: section === "quiet" && r.idle_days !== null ? Number(r.idle_days) : null,
  }));
  return { section, counts: countsByKey, rows, more: raw.length > INBOX_ROW_LIMIT };
}
