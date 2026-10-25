import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { lead, leadActivity, leadClaim, leadNote, leadProgrammePref, messageTemplate, pipelineStage, programme, university } from "@/server/db/schema";
import { uuidv7 } from "@/lib/uuid";
import { runAs } from "./as-actor";
import { teamMembersOf, teamQuery, type TeamMember } from "./team";

/**
 * Admin lead management reads and writes (architecture 7.2, 8.3, S5.1 to S5.6). Every function takes an `Actor` and runs inside
 * `runAs`, so row level security is the second lock: only staff can read leads other than their own, write activity, or
 * change a lead (policies in migration 0003). Anything that must be atomic across tables, or that reads Neon Auth, is a
 * database function in migration 0006 (decide a claim, resolve a duplicate, erase a lead).
 *
 * Writes that depend on what the screen saw carry `version`, the lead's `updated_at` as text with microseconds (a JavaScript
 * Date would lose them). A change whose version no longer matches does nothing and reports `conflict` (S5.6).
 */

// ----------------------------------------------------------------------------------------------------------------
// Versions (S5.6)
// ----------------------------------------------------------------------------------------------------------------

const VERSION_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;

/** `updated_at` as an ISO text with microseconds. */
const versionOf = (column: SQL | typeof lead.updatedAt) => sql<string>`to_char(${column} at time zone 'UTC', ${sql.raw(`'${VERSION_FORMAT}'`)})`;

/** A version a client sent back: the exact text we produced, nothing else (it is cast to a timestamp in SQL). */
export const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

// ----------------------------------------------------------------------------------------------------------------
// Lists (S5.1, S5.3)
// ----------------------------------------------------------------------------------------------------------------

export type LeadView = "all" | "unanswered" | "overdue" | "unassigned";

export interface LeadListFilters {
  view: LeadView;
  stage?: string;
  country?: string;
  universityId?: string;
  /** `me`, `none`, or an admin's user id. */
  assigned?: string;
  /** Name, reference or WhatsApp number (or part of one). */
  q?: string;
  /** Keyset cursor: the id of the last row of the previous page. */
  before?: string;
  limit: number;
  now: Date;
}

export interface LeadListRow {
  id: string;
  ref: string;
  name: string | null;
  countryCode: string;
  stageCode: string;
  assignedAdminId: string | null;
  receivedAt: Date;
  slaDueAt: Date;
  firstResponseAt: Date | null;
  anonymisedAt: Date | null;
  intakeKind: string;
}

const listColumns = {
  id: lead.id,
  ref: lead.ref,
  name: lead.name,
  countryCode: lead.countryCode,
  stageCode: lead.stageCode,
  assignedAdminId: lead.assignedAdminId,
  receivedAt: lead.receivedAt,
  slaDueAt: lead.slaDueAt,
  firstResponseAt: lead.firstResponseAt,
  anonymisedAt: lead.anonymisedAt,
  intakeKind: lead.intakeKind,
};

/** A search term made safe for LIKE: the characters that mean something to LIKE are matched as themselves. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

/** The digits of a phone-looking search ("+237 6 12-34", "612345"), or null when the text is not number-like. */
export function digitsOfNumberSearch(term: string): string | null {
  if (!/^[+\d\s().-]{4,}$/.test(term)) return null;
  const digits = term.replace(/\D/g, "");
  return digits.length >= 4 ? digits : null;
}

/** The conditions of a list. Exported so a test can read what a filter produces. */
export function leadListConditions(actor: Pick<Actor, "userId">, filters: LeadListFilters): (SQL | undefined)[] {
  const search = filters.q?.trim();
  const digits = search ? digitsOfNumberSearch(search) : null;
  const refTerm = search?.toUpperCase();
  return [
    // A merged lead is not a lead of its own any more (it shows under the one it was merged into).
    isNull(lead.mergedIntoId),
    filters.view === "overdue" ? and(isNull(lead.firstResponseAt), isNull(lead.anonymisedAt), sql`${lead.slaDueAt} < ${filters.now.toISOString()}::timestamptz`) : undefined,
    filters.view === "unanswered" ? and(isNull(lead.firstResponseAt), isNull(lead.anonymisedAt)) : undefined,
    filters.view === "unassigned" ? and(isNull(lead.assignedAdminId), isNull(lead.anonymisedAt)) : undefined,
    filters.stage ? eq(lead.stageCode, filters.stage) : undefined,
    filters.country ? eq(lead.countryCode, filters.country) : undefined,
    filters.universityId
      ? sql`(${lead.source}->>'university_id' = ${filters.universityId} or exists (
          select 1 from lead_programme_pref pp join programme p on p.id = pp.programme_id
           where pp.lead_id = ${lead.id} and p.university_id = ${filters.universityId}::uuid))`
      : undefined,
    filters.assigned === "me" ? eq(lead.assignedAdminId, actor.userId) : filters.assigned === "none" ? isNull(lead.assignedAdminId) : filters.assigned ? eq(lead.assignedAdminId, filters.assigned) : undefined,
    search
      ? or(
          ilike(lead.name, likePattern(search)),
          sql`${lead.ref} like ${likePattern(refTerm ?? search)}`,
          sql`${lead.clientRef} like ${likePattern(refTerm ?? search)}`,
          digits ? sql`${lead.whatsappE164} like ${likePattern(digits)}` : undefined,
        )
      : undefined,
    filters.before
      ? filters.view === "overdue"
        ? sql`(${lead.slaDueAt}, ${lead.id}) > (select l0.sla_due_at, l0.id from lead l0 where l0.id = ${filters.before}::uuid)`
        : sql`(${lead.receivedAt}, ${lead.id}) < (select l0.received_at, l0.id from lead l0 where l0.id = ${filters.before}::uuid)`
      : undefined,
  ];
}

/** Newest first; the Overdue view is oldest due first (B2 step 4). `limit` is capped so a screen can never ask for the whole table. */
export async function listLeadsAdmin(db: Db, actor: Actor, filters: LeadListFilters): Promise<LeadListRow[]> {
  const limit = Math.min(Math.max(Math.trunc(filters.limit), 1), 201);
  const [rows] = await runAs(
    db,
    actor,
    db
      .select(listColumns)
      .from(lead)
      .where(and(...leadListConditions(actor, filters)))
      .orderBy(...(filters.view === "overdue" ? [asc(lead.slaDueAt), asc(lead.id)] : [desc(lead.receivedAt), desc(lead.id)]))
      .limit(limit),
  );
  return rows;
}

export interface OverviewCounts {
  unanswered: number;
  overdue: number;
  mine: number;
  unassigned: number;
  today: number;
  pendingClaims: number;
  openDataRequests: number;
  funnel: { stageCode: string; count: number }[];
}

/**
 * The Overview numbers (B1, S5.3). The counts are one statement with COUNT(*) FILTER, so the page costs one round trip
 * whatever the number of leads. `today` is the WAT calendar day given by `dayStart` and `dayEnd` (UTC instants).
 */
export async function getOverviewCounts(db: Db, actor: Actor, now: Date, dayStart: Date, dayEnd: Date): Promise<OverviewCounts> {
  const [counts, funnel] = await runAs(
    db,
    actor,
    db.execute(sql`
      select
        count(*) filter (where l.first_response_at is null and l.anonymised_at is null)::int as unanswered,
        count(*) filter (where l.first_response_at is null and l.anonymised_at is null and l.sla_due_at < ${now.toISOString()}::timestamptz)::int as overdue,
        count(*) filter (where l.assigned_admin_id = ${actor.userId})::int as mine,
        count(*) filter (where l.assigned_admin_id is null and l.anonymised_at is null)::int as unassigned,
        count(*) filter (where l.received_at >= ${dayStart.toISOString()}::timestamptz and l.received_at < ${dayEnd.toISOString()}::timestamptz)::int as today,
        (select count(*) from lead_claim c where c.status = 'pending')::int as pending_claims,
        (select count(*) from data_request d where d.status = 'open')::int as open_data_requests
      from lead l
      where l.merged_into_id is null`),
    db.execute(sql`
      select s.code as stage_code, count(l.id)::int as count
        from pipeline_stage s left join lead l on l.stage_code = s.code and l.merged_into_id is null and l.anonymised_at is null
       group by s.code, s.position
       order by s.position`),
  );
  const c = rowsOf<{ unanswered: number; overdue: number; mine: number; unassigned: number; today: number; pending_claims: number; open_data_requests: number }>(counts)[0];
  return {
    unanswered: c?.unanswered ?? 0,
    overdue: c?.overdue ?? 0,
    mine: c?.mine ?? 0,
    unassigned: c?.unassigned ?? 0,
    today: c?.today ?? 0,
    pendingClaims: c?.pending_claims ?? 0,
    openDataRequests: c?.open_data_requests ?? 0,
    funnel: rowsOf<{ stage_code: string; count: number }>(funnel).map((r) => ({ stageCode: r.stage_code, count: Number(r.count) })),
  };
}

// ----------------------------------------------------------------------------------------------------------------
// Duplicates (S5.4): a query on the WhatsApp number, never a table, never automatic
// ----------------------------------------------------------------------------------------------------------------

export interface DuplicatePair {
  a: { id: string; ref: string; name: string; receivedAt: Date; stageCode: string };
  b: { id: string; ref: string; name: string; receivedAt: Date; stageCode: string };
}

type PairRow = {
  a_id: string;
  a_ref: string;
  a_name: string;
  a_received: string | Date;
  a_stage: string;
  b_id: string;
  b_ref: string;
  b_name: string;
  b_received: string | Date;
  b_stage: string;
};

function toPair(r: PairRow): DuplicatePair {
  return {
    a: { id: r.a_id, ref: r.a_ref, name: r.a_name, receivedAt: new Date(r.a_received), stageCode: r.a_stage },
    b: { id: r.b_id, ref: r.b_ref, name: r.b_name, receivedAt: new Date(r.b_received), stageCode: r.b_stage },
  };
}

/** Pairs of live leads with the same WhatsApp number that nobody has decided on, newest first. `leadId` limits it to one lead. */
export async function listDuplicatePairs(db: Db, actor: Actor, options: { leadId?: string; limit?: number } = {}): Promise<DuplicatePair[]> {
  const [result] = await runAs(db, actor, duplicatePairsQuery(db, options));
  return rowsOf<PairRow>(result).map(toPair);
}

/** The statement behind `listDuplicatePairs`, for a screen that runs it together with its other reads in one round trip. */
function duplicatePairsQuery(db: Db, options: { leadId?: string; limit?: number }) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
  return db.execute(sql`
      select a.id as a_id, a.ref as a_ref, a.name as a_name, a.received_at as a_received, a.stage_code as a_stage,
             b.id as b_id, b.ref as b_ref, b.name as b_name, b.received_at as b_received, b.stage_code as b_stage
        from lead a
        join lead b on b.whatsapp_e164 = a.whatsapp_e164 and a.id < b.id
       where a.merged_into_id is null and b.merged_into_id is null and a.anonymised_at is null and b.anonymised_at is null
         ${options.leadId ? sql`and (a.id = ${options.leadId}::uuid or b.id = ${options.leadId}::uuid)` : sql``}
         and not exists (select 1 from lead_duplicate_decision d
                          where (d.lead_a_id = a.id and d.lead_b_id = b.id) or (d.lead_a_id = b.id and d.lead_b_id = a.id))
       order by greatest(a.received_at, b.received_at) desc, a.id
       limit ${limit}`);
}

export type ResolveDuplicateOutcome = "merged" | "dismissed" | "not_found" | "not_a_pair" | "already_decided";

/** Merge `other` into `keep`, or record that they are not duplicates (`app_resolve_duplicate`). One transaction; audited. */
export async function resolveDuplicate(db: Db, actor: Actor, keep: string, other: string, decision: "merged" | "not_duplicate"): Promise<ResolveDuplicateOutcome> {
  const [result] = await runAs(db, actor, db.execute(sql`select public.app_resolve_duplicate(${keep}::uuid, ${other}::uuid, ${decision}) as outcome`));
  return (rowsOf<{ outcome: ResolveDuplicateOutcome }>(result)[0]?.outcome ?? "not_found") as ResolveDuplicateOutcome;
}

// ----------------------------------------------------------------------------------------------------------------
// Lead detail (S5.2)
// ----------------------------------------------------------------------------------------------------------------

export interface LeadDetailRow {
  id: string;
  ref: string;
  name: string | null;
  whatsappE164: string | null;
  email: string | null;
  countryCode: string;
  intakeKind: string;
  qualificationType: string | null;
  results: { subject: string; grade: string }[];
  source: Record<string, unknown>;
  locale: string;
  stageCode: string;
  assignedAdminId: string | null;
  userId: string | null;
  receivedAt: Date;
  slaDueAt: Date;
  slaHoursApplied: number;
  firstResponseAt: Date | null;
  lastActivityAt: Date;
  mergedIntoId: string | null;
  anonymisedAt: Date | null;
  /** The text a save must send back (S5.6). */
  version: string;
}

const detailColumns = {
  id: lead.id,
  ref: lead.ref,
  name: lead.name,
  whatsappE164: lead.whatsappE164,
  email: lead.email,
  countryCode: lead.countryCode,
  intakeKind: lead.intakeKind,
  qualificationType: lead.qualificationType,
  results: lead.results,
  source: lead.source,
  locale: lead.locale,
  stageCode: lead.stageCode,
  assignedAdminId: lead.assignedAdminId,
  userId: lead.userId,
  receivedAt: lead.receivedAt,
  slaDueAt: lead.slaDueAt,
  slaHoursApplied: lead.slaHoursApplied,
  firstResponseAt: lead.firstResponseAt,
  lastActivityAt: lead.lastActivityAt,
  mergedIntoId: lead.mergedIntoId,
  anonymisedAt: lead.anonymisedAt,
  version: versionOf(lead.updatedAt),
};

export interface ProgrammePref {
  rank: number;
  programmeId: string;
  programmeName: string;
  universityName: string;
}

export interface ActivityRow {
  id: string;
  type: string;
  actorId: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface NoteRow {
  id: string;
  authorId: string;
  body: string;
  createdAt: Date;
  erased: boolean;
}

export interface LeadDetail {
  lead: LeadDetailRow;
  /** Where the lead was merged to, as a reference, when it was merged away. */
  mergedIntoRef: string | null;
  prefs: ProgrammePref[];
  /** Newest first, capped. */
  activities: ActivityRow[];
  notes: NoteRow[];
  /** The university the student was looking at when they asked, when the lead has one. */
  sourceUniversityName: string | null;
  pendingClaims: number;
}

export const TIMELINE_LIMIT = 200;

export async function getLeadDetail(db: Db, actor: Actor, id: string): Promise<LeadDetail | null> {
  const [leads, prefs, activities, notes, claims] = await runAs(
    db,
    actor,
    db.select(detailColumns).from(lead).where(eq(lead.id, id)).limit(1),
    db
      .select({ rank: leadProgrammePref.rank, programmeId: programme.id, programmeName: programme.name, universityName: university.name })
      .from(leadProgrammePref)
      .innerJoin(programme, eq(programme.id, leadProgrammePref.programmeId))
      .innerJoin(university, eq(university.id, programme.universityId))
      .where(eq(leadProgrammePref.leadId, id))
      .orderBy(asc(leadProgrammePref.rank)),
    db
      .select({ id: leadActivity.id, type: leadActivity.type, actorId: leadActivity.actorId, data: leadActivity.data, createdAt: leadActivity.createdAt })
      .from(leadActivity)
      .where(eq(leadActivity.leadId, id))
      .orderBy(desc(leadActivity.createdAt), desc(leadActivity.id))
      .limit(TIMELINE_LIMIT),
    db
      .select({ id: leadNote.id, authorId: leadNote.authorId, body: leadNote.body, createdAt: leadNote.createdAt, erasedAt: leadNote.erasedAt })
      .from(leadNote)
      .where(eq(leadNote.leadId, id))
      .orderBy(desc(leadNote.createdAt))
      .limit(TIMELINE_LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(leadClaim).where(and(eq(leadClaim.leadId, id), eq(leadClaim.status, "pending"))),
  );
  const row = leads[0];
  if (!row) return null;

  // Two small reads that need the row first. They run together.
  const universityId = typeof row.source.university_id === "string" && /^[0-9a-f-]{36}$/i.test(row.source.university_id) ? row.source.university_id : null;
  const [mergedTo, sourceUniversity] = await runAs(
    db,
    actor,
    row.mergedIntoId ? db.select({ ref: lead.ref }).from(lead).where(eq(lead.id, row.mergedIntoId)).limit(1) : db.select({ ref: lead.ref }).from(lead).where(sql`false`),
    universityId ? db.select({ name: university.name }).from(university).where(eq(university.id, universityId)).limit(1) : db.select({ name: university.name }).from(university).where(sql`false`),
  );

  return {
    lead: row,
    mergedIntoRef: mergedTo[0]?.ref ?? null,
    prefs,
    activities,
    notes: notes.map((n) => ({ id: n.id, authorId: n.authorId, body: n.body, createdAt: n.createdAt, erased: n.erasedAt !== null })),
    sourceUniversityName: sourceUniversity[0]?.name ?? null,
    pendingClaims: claims[0]?.n ?? 0,
  };
}

export interface LeadScreen extends LeadDetail {
  stages: { code: string; position: number; name: Record<string, string> | string }[];
  team: TeamMember[];
  /** The published staff template for this lead's stage and language, or null. */
  template: string | null;
  duplicates: DuplicatePair[];
}

/**
 * Everything the lead detail screen shows, in ONE round trip (Stage 5 CPU repair, tracker Session 23). Each separate read is an
 * HTTP request to Neon, and each costs the Worker CPU time; the screen used to make seven of them and measured 13 ms warm against
 * the 8 ms gate. The reads that depend on the lead row (its stage and language for the template, the lead it was merged into, the
 * university it came from) take it through a sub-select instead of waiting for it.
 */
export async function getLeadScreen(db: Db, actor: Actor, id: string): Promise<LeadScreen | null> {
  const [leads, prefs, activities, notes, claims, stages, team, template, mergedTo, sourceUniversity, duplicates] = await runAs(
    db,
    actor,
    db.select(detailColumns).from(lead).where(eq(lead.id, id)).limit(1),
    db
      .select({ rank: leadProgrammePref.rank, programmeId: programme.id, programmeName: programme.name, universityName: university.name })
      .from(leadProgrammePref)
      .innerJoin(programme, eq(programme.id, leadProgrammePref.programmeId))
      .innerJoin(university, eq(university.id, programme.universityId))
      .where(eq(leadProgrammePref.leadId, id))
      .orderBy(asc(leadProgrammePref.rank)),
    db
      .select({ id: leadActivity.id, type: leadActivity.type, actorId: leadActivity.actorId, data: leadActivity.data, createdAt: leadActivity.createdAt })
      .from(leadActivity)
      .where(eq(leadActivity.leadId, id))
      .orderBy(desc(leadActivity.createdAt), desc(leadActivity.id))
      .limit(TIMELINE_LIMIT),
    db
      .select({ id: leadNote.id, authorId: leadNote.authorId, body: leadNote.body, createdAt: leadNote.createdAt, erasedAt: leadNote.erasedAt })
      .from(leadNote)
      .where(eq(leadNote.leadId, id))
      .orderBy(desc(leadNote.createdAt))
      .limit(TIMELINE_LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(leadClaim).where(and(eq(leadClaim.leadId, id), eq(leadClaim.status, "pending"))),
    db.select().from(pipelineStage).orderBy(asc(pipelineStage.position)),
    teamQuery(db),
    db.execute(sql`
      select body from message_template
       where stage_code = (select stage_code from lead where id = ${id}::uuid) and locale = (select locale from lead where id = ${id}::uuid) and status = 'published'
       order by id limit 1`),
    db.execute(sql`select ref from lead where id = (select merged_into_id from lead where id = ${id}::uuid)`),
    db.execute(sql`select name from university where id::text = (select source->>'university_id' from lead where id = ${id}::uuid)`),
    duplicatePairsQuery(db, { leadId: id, limit: 5 }),
  );
  const row = leads[0];
  if (!row) return null;
  return {
    lead: row,
    mergedIntoRef: rowsOf<{ ref: string }>(mergedTo)[0]?.ref ?? null,
    prefs,
    activities,
    notes: notes.map((n) => ({ id: n.id, authorId: n.authorId, body: n.body, createdAt: n.createdAt, erased: n.erasedAt !== null })),
    sourceUniversityName: rowsOf<{ name: string }>(sourceUniversity)[0]?.name ?? null,
    pendingClaims: claims[0]?.n ?? 0,
    stages: stages.map((r) => ({ code: r.code, position: r.position, name: r.name as Record<string, string> })),
    team: teamMembersOf(team),
    template: rowsOf<{ body: string }>(template)[0]?.body ?? null,
    duplicates: rowsOf<PairRow>(duplicates).map(toPair),
  };
}

/** The pipeline in order, for the stage control and the Overview funnel. */
export async function listStageNames(db: Db, actor: Actor): Promise<{ code: string; position: number; name: Record<string, string> | string }[]> {
  const [rows] = await runAs(db, actor, db.select().from(pipelineStage).orderBy(asc(pipelineStage.position)));
  return rows.map((r) => ({ code: r.code, position: r.position, name: r.name as Record<string, string> }));
}

/** The message template for a stage and locale, when staff have published one (B3 step 2). Null means the screen uses its built-in text. */
export async function findStageTemplate(db: Db, actor: Actor, stageCode: string, locale: string): Promise<string | null> {
  const [rows] = await runAs(
    db,
    actor,
    db
      .select({ body: messageTemplate.body })
      .from(messageTemplate)
      .where(and(eq(messageTemplate.stageCode, stageCode), eq(messageTemplate.locale, locale), eq(messageTemplate.status, "published")))
      .orderBy(asc(messageTemplate.id))
      .limit(1),
  );
  return rows[0]?.body ?? null;
}

// ----------------------------------------------------------------------------------------------------------------
// Changes (S5.2). Each is one statement: the change, its activity and (where the table says so) its audit row
// commit together or not at all.
// ----------------------------------------------------------------------------------------------------------------

/** A change that did nothing, and why. `conflict` carries the version the screen should reload. */
export type MissOutcome =
  | { kind: "unchanged"; version: string }
  | { kind: "conflict"; version: string }
  | { kind: "unavailable" }
  | { kind: "not_found" }
  | { kind: "unknown_stage" };

export type ChangeOutcome<T = object> = ({ kind: "ok"; version: string } & T) | MissOutcome;

interface LeadState {
  version: string;
  stageCode: string;
  assignedAdminId: string | null;
  unavailable: boolean;
}

async function readState(db: Db, actor: Actor, id: string): Promise<LeadState | null> {
  const [rows] = await runAs(
    db,
    actor,
    db
      .select({ version: versionOf(lead.updatedAt), stageCode: lead.stageCode, assignedAdminId: lead.assignedAdminId, anonymisedAt: lead.anonymisedAt, mergedIntoId: lead.mergedIntoId })
      .from(lead)
      .where(eq(lead.id, id))
      .limit(1),
  );
  const row = rows[0];
  return row ? { version: row.version, stageCode: row.stageCode, assignedAdminId: row.assignedAdminId, unavailable: row.anonymisedAt !== null || row.mergedIntoId !== null } : null;
}

/** Why a change that matched no row did nothing, read after the fact (the cheap path never pays for this). */
async function explainMiss(db: Db, actor: Actor, id: string, check?: (s: LeadState) => MissOutcome | null): Promise<MissOutcome> {
  const state = await readState(db, actor, id);
  if (!state) return { kind: "not_found" };
  if (state.unavailable) return { kind: "unavailable" };
  return check?.(state) ?? { kind: "conflict", version: state.version };
}

const returnedVersion = (result: unknown): string | null => rowsOf<{ version: string | null }>(result)[0]?.version ?? null;

/** S5.2 step 6. Moves the lead to `stage` when the version still matches. */
export async function changeStage(db: Db, actor: Actor, input: { leadId: string; stage: string; version: string }): Promise<ChangeOutcome<{ from: string }>> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with target as (
        select l.id, l.stage_code as old_stage from lead l where l.id = ${input.leadId}::uuid
      ), upd as (
        update lead l set stage_code = ${input.stage}, last_activity_at = now()
          from target
         where l.id = target.id and l.updated_at = ${input.version}::timestamptz
           and l.anonymised_at is null and l.merged_into_id is null and l.stage_code <> ${input.stage}
           and exists (select 1 from pipeline_stage s where s.code = ${input.stage})
        returning l.id, target.old_stage, to_char(l.updated_at at time zone 'UTC', ${sql.raw(`'${VERSION_FORMAT}'`)}) as version
      ), act as (
        insert into lead_activity (id, lead_id, type, actor_id, data)
        select ${uuidv7()}::uuid, id, 'stage_changed', ${actor.userId}, jsonb_build_object('from', old_stage, 'to', ${input.stage}::text) from upd
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select ${uuidv7()}::uuid, ${actor.userId}, 'leads.changeStage', 'lead', id::text, jsonb_build_object('from', old_stage, 'to', ${input.stage}::text) from upd
      )
      select version, old_stage from upd`),
  );
  const row = rowsOf<{ version: string; old_stage: string }>(result)[0];
  if (row) return { kind: "ok", version: row.version, from: row.old_stage };
  const miss = await explainMiss(db, actor, input.leadId, (s) => (s.stageCode === input.stage ? { kind: "unchanged", version: s.version } : null));
  if (miss.kind !== "conflict") return miss;
  // A stale version and an unknown stage both match no row; tell them apart.
  const [stages] = await runAs(db, actor, db.select({ code: pipelineStage.code }).from(pipelineStage).where(eq(pipelineStage.code, input.stage)));
  return stages.length === 0 ? { kind: "unknown_stage" } : miss;
}

/** S5.2 step 7. `adminId` null puts the lead back in the unassigned pool. The caller has checked that the id is a staff member. */
export async function assignLead(db: Db, actor: Actor, input: { leadId: string; adminId: string | null; version: string }): Promise<ChangeOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with target as (
        select l.id, l.assigned_admin_id as old_admin from lead l where l.id = ${input.leadId}::uuid
      ), upd as (
        update lead l set assigned_admin_id = ${input.adminId}, last_activity_at = now()
          from target
         where l.id = target.id and l.updated_at = ${input.version}::timestamptz
           and l.anonymised_at is null and l.merged_into_id is null
           and l.assigned_admin_id is distinct from ${input.adminId}::text
        returning l.id, target.old_admin, to_char(l.updated_at at time zone 'UTC', ${sql.raw(`'${VERSION_FORMAT}'`)}) as version
      ), act as (
        insert into lead_activity (id, lead_id, type, actor_id, data)
        select ${uuidv7()}::uuid, id, 'assigned', ${actor.userId}, jsonb_build_object('from', old_admin, 'to', ${input.adminId}::text) from upd
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select ${uuidv7()}::uuid, ${actor.userId}, 'leads.assign', 'lead', id::text, jsonb_build_object('from', old_admin, 'to', ${input.adminId}::text) from upd
      )
      select version from upd`),
  );
  const version = returnedVersion(result);
  if (version) return { kind: "ok", version };
  return explainMiss(db, actor, input.leadId, (s) => (s.assignedAdminId === input.adminId ? { kind: "unchanged", version: s.version } : null));
}

/** S5.2 step 8. A note is added, never edited, so it needs no version. The activity holds only the note's id (ADR-007). */
export async function addNote(db: Db, actor: Actor, input: { leadId: string; body: string }): Promise<{ kind: "ok"; noteId: string } | { kind: "unavailable" } | { kind: "not_found" }> {
  const noteId = uuidv7();
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with n as (
        insert into lead_note (id, lead_id, author_id, body)
        select ${noteId}::uuid, l.id, ${actor.userId}, ${input.body}
          from lead l where l.id = ${input.leadId}::uuid and l.anonymised_at is null and l.merged_into_id is null
        returning id, lead_id
      ), act as (
        insert into lead_activity (id, lead_id, type, actor_id, data)
        select ${uuidv7()}::uuid, lead_id, 'note', ${actor.userId}, jsonb_build_object('note_id', id) from n
      ), touch as (
        update lead set last_activity_at = now() where id in (select lead_id from n)
      )
      select count(*)::int as n from n`),
  );
  if ((rowsOf<{ n: number }>(result)[0]?.n ?? 0) > 0) return { kind: "ok", noteId };
  const state = await readState(db, actor, input.leadId);
  return state ? { kind: "unavailable" } : { kind: "not_found" };
}

/**
 * S5.2 step 5: "Log reply", one tap. The first one sets `first_response_at` (and so the SLA badge becomes Met); later ones
 * only add to the timeline. `first` says whether this tap was the first reply.
 */
export async function logReply(db: Db, actor: Actor, leadId: string): Promise<{ kind: "ok"; first: boolean; version: string } | { kind: "unavailable" } | { kind: "not_found" }> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with before as (
        select l.id, (l.first_response_at is null) as first from lead l
         where l.id = ${leadId}::uuid and l.anonymised_at is null and l.merged_into_id is null
      ), upd as (
        update lead l set first_response_at = coalesce(l.first_response_at, now()), last_activity_at = now()
          from before where l.id = before.id
        returning l.id, before.first, to_char(l.updated_at at time zone 'UTC', ${sql.raw(`'${VERSION_FORMAT}'`)}) as version
      ), act as (
        insert into lead_activity (id, lead_id, type, actor_id, data)
        select ${uuidv7()}::uuid, id, 'reply_logged', ${actor.userId}, jsonb_build_object('first', first) from upd
      )
      select first, version from upd`),
  );
  const row = rowsOf<{ first: boolean; version: string }>(result)[0];
  if (row) return { kind: "ok", first: row.first === true, version: row.version };
  const state = await readState(db, actor, leadId);
  return state ? { kind: "unavailable" } : { kind: "not_found" };
}

/** S5.2 step 3: the admin opened WhatsApp to the student. Only a timeline entry. */
export async function logAdminWhatsAppOpen(db: Db, actor: Actor, leadId: string): Promise<{ kind: "ok" } | { kind: "unavailable" } | { kind: "not_found" }> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with act as (
        insert into lead_activity (id, lead_id, type, actor_id, data)
        select ${uuidv7()}::uuid, l.id, 'admin_wa_opened', ${actor.userId}, '{}'::jsonb
          from lead l where l.id = ${leadId}::uuid and l.anonymised_at is null and l.merged_into_id is null
        returning id
      )
      select count(*)::int as n from act`),
  );
  if ((rowsOf<{ n: number }>(result)[0]?.n ?? 0) > 0) return { kind: "ok" };
  const state = await readState(db, actor, leadId);
  return state ? { kind: "unavailable" } : { kind: "not_found" };
}

// ----------------------------------------------------------------------------------------------------------------
// Erasure (S5.5)
// ----------------------------------------------------------------------------------------------------------------

export type EraseOutcome = "erased" | "identity_not_confirmed" | "not_found" | "already_erased" | "request_mismatch";

/** `app_erase_lead`: one transaction, so a failure halfway leaves nothing half-erased. */
export async function eraseLead(db: Db, actor: Actor, input: { leadId: string; identityConfirmed: boolean; dataRequestId?: string | null }): Promise<EraseOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`select public.app_erase_lead(${input.leadId}::uuid, ${input.identityConfirmed}, ${input.dataRequestId ?? null}::uuid) as outcome`),
  );
  return (rowsOf<{ outcome: EraseOutcome }>(result)[0]?.outcome ?? "not_found") as EraseOutcome;
}

/** Exists so a caller can ask "is there any lead with this reference" without reading the row (data request logging). */
export async function findLeadIdByRef(db: Db, actor: Actor, ref: string): Promise<{ id: string; anonymised: boolean } | null> {
  const [rows] = await runAs(db, actor, db.select({ id: lead.id, anonymisedAt: lead.anonymisedAt }).from(lead).where(eq(lead.ref, ref.toUpperCase())).limit(1));
  const row = rows[0];
  return row ? { id: row.id, anonymised: row.anonymisedAt !== null } : null;
}


/** Universities for the list filter (staff see every status). */
export async function listUniversityOptions(db: Db, actor: Actor): Promise<{ id: string; name: string }[]> {
  const [rows] = await runAs(db, actor, db.select({ id: university.id, name: university.name }).from(university).orderBy(asc(university.name)));
  return rows;
}
