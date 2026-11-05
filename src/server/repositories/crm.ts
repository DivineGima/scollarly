import { sql, type SQL } from "drizzle-orm";
import type { CrmFilters } from "@/modules/crm/filters";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * The CRM reads (PRD_3 F18 amended, architecture 22.8, ADR-057): aggregates over leads we already keep, as the caller (row level security is the
 * second lock). No new table and no job. Each function is one transaction, so a screen costs one round trip to the database.
 * Merged and erased leads are never counted.
 */

const VERSION_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;
const n = (value: unknown) => Number(value ?? 0);
const nOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** The conditions every CRM read shares: live leads, the country, the source page and whom they are assigned to. The date range is added by each read. */
function leadFilter(actor: Actor, f: Pick<CrmFilters, "country" | "source" | "assigned">): SQL {
  const parts: SQL[] = [sql`l.merged_into_id is null and l.anonymised_at is null`];
  if (f.country) parts.push(sql`l.country_code = ${f.country}`);
  if (f.source) parts.push(sql`coalesce(l.source ->> 'page', 'unknown') = ${f.source}`);
  if (f.assigned === "me") parts.push(sql`l.assigned_admin_id = ${actor.userId}`);
  if (f.assigned === "unassigned") parts.push(sql`l.assigned_admin_id is null`);
  return sql.join(parts, sql` and `);
}

export interface PeriodNumbers {
  leads: number;
  answered: number;
  /** Mean minutes from receipt to the first reply, over the leads answered; null when none was. */
  avgFirstResponseMinutes: number | null;
}

export interface CrmOverview {
  current: PeriodNumbers;
  previous: PeriodNumbers;
  overdue: number;
  arrived: number;
  stages: { code: string; position: number; name: Record<string, string> | string; count: number }[];
  days: { day: string; n: number }[];
  countries: { key: string; count: number }[];
  sources: { key: string; count: number }[];
  /**
   * Profiles finished in the range, and how many of them have applied by now (PRD_4 F27, architecture 23.6). Null when a filter is set that a
   * profile does not have (a source page, an assigned admin): the numbers would be about different people than the rest of the screen.
   */
  onboarding: { onboarded: number; applied: number } | null;
}

export async function crmOverview(db: Db, actor: Actor, f: CrmFilters): Promise<CrmOverview> {
  const start = f.range.start.toISOString();
  const end = f.range.end.toISOString();
  const prevStart = new Date(f.range.start.getTime() - (f.range.end.getTime() - f.range.start.getTime())).toISOString();
  const where = leadFilter(actor, f);
  const inCur = sql`l.received_at >= ${start}::timestamptz and l.received_at < ${end}::timestamptz`;
  const inPrev = sql`l.received_at >= ${prevStart}::timestamptz and l.received_at < ${start}::timestamptz`;
  const minutes = sql`extract(epoch from (l.first_response_at - l.received_at)) / 60.0`;

  const profilesApply = f.source === null && f.assigned === "all";
  const [summary, stages, days, countries, sources, profiles] = await runAs(
    db,
    actor,
    db.execute(sql`
      select count(*) filter (where ${inCur}) as leads_cur,
             count(*) filter (where ${inPrev}) as leads_prev,
             count(*) filter (where ${inCur} and l.first_response_at is not null) as answered_cur,
             count(*) filter (where ${inPrev} and l.first_response_at is not null) as answered_prev,
             avg(${minutes}) filter (where ${inCur} and l.first_response_at is not null) as avg_cur,
             avg(${minutes}) filter (where ${inPrev} and l.first_response_at is not null) as avg_prev,
             count(*) filter (where ${inCur} and l.first_response_at is null and l.stage_code <> 'arrived' and l.sla_due_at < now()) as overdue,
             count(*) filter (where ${inCur} and l.stage_code = 'arrived') as arrived
        from lead l
       where ${where} and l.received_at >= ${prevStart}::timestamptz and l.received_at < ${end}::timestamptz`),
    db.execute(sql`
      select s.code, s.position, s.name, count(l.id)::int as n
        from pipeline_stage s
        left join lead l on l.stage_code = s.code and ${where} and ${inCur}
       group by s.code, s.position, s.name
       order by s.position`),
    db.execute(sql`
      select to_char((l.received_at + interval '1 hour')::date, 'YYYY-MM-DD') as day, count(*)::int as n
        from lead l where ${where} and ${inCur} group by 1`),
    db.execute(sql`
      select l.country_code as key, count(*)::int as n from lead l where ${where} and ${inCur} group by 1 order by 2 desc limit 40`),
    db.execute(sql`
      select coalesce(l.source ->> 'page', 'unknown') as key, count(*)::int as n from lead l where ${where} and ${inCur} group by 1 order by 2 desc limit 40`),
    // Profiles, not leads: a profile is not a lead, so nothing above is changed by this one (it only counts students who finished onboarding).
    profilesApply
      ? db.execute(sql`
          select count(*)::int as onboarded, count(*) filter (where sp.lead_id is not null)::int as applied
            from student_profile sp
           where sp.onboarded_at >= ${start}::timestamptz and sp.onboarded_at < ${end}::timestamptz
             ${f.country ? sql`and sp.applicant_country = ${f.country}` : sql``}`)
      : db.execute(sql`select 0::int as onboarded, 0::int as applied`),
  );

  const s = rowsOf<Record<string, unknown>>(summary)[0] ?? {};
  return {
    current: { leads: n(s.leads_cur), answered: n(s.answered_cur), avgFirstResponseMinutes: nOrNull(s.avg_cur) },
    previous: { leads: n(s.leads_prev), answered: n(s.answered_prev), avgFirstResponseMinutes: nOrNull(s.avg_prev) },
    overdue: n(s.overdue),
    arrived: n(s.arrived),
    stages: rowsOf<{ code: string; position: number; name: Record<string, string> | string; n: number }>(stages).map((row) => ({ code: row.code, position: n(row.position), name: row.name, count: n(row.n) })),
    days: rowsOf<{ day: string; n: number }>(days).map((row) => ({ day: row.day, n: n(row.n) })),
    countries: rowsOf<{ key: string; n: number }>(countries).map((row) => ({ key: row.key, count: n(row.n) })),
    sources: rowsOf<{ key: string; n: number }>(sources).map((row) => ({ key: row.key, count: n(row.n) })),
    onboarding: profilesApply ? { onboarded: n(rowsOf<Record<string, unknown>>(profiles)[0]?.onboarded), applied: n(rowsOf<Record<string, unknown>>(profiles)[0]?.applied) } : null,
  };
}

export interface BoardCard {
  id: string;
  ref: string;
  name: string | null;
  country: string;
  receivedAt: string;
  answered: boolean;
  overdue: boolean;
  assigned: boolean;
  /** The version a stage change must carry (optimistic concurrency, architecture 13.6). */
  version: string;
}

export interface BoardColumn {
  code: string;
  position: number;
  name: Record<string, string> | string;
  total: number;
  cards: BoardCard[];
}

/** How many cards a column shows; the rest are counted and reached through the leads list. */
export const BOARD_COLUMN_LIMIT = 8;

/** The pipeline as columns, newest first. The date range does not apply: a lead waiting at "visa" belongs on the board however old it is. */
export async function pipelineBoard(db: Db, actor: Actor, f: Pick<CrmFilters, "country" | "source" | "assigned">, now: Date): Promise<BoardColumn[]> {
  const where = leadFilter(actor, f);
  const [stages, cards, counts] = await runAs(
    db,
    actor,
    db.execute(sql`select code, position, name from pipeline_stage order by position`),
    db.execute(sql`
      select * from (
        select l.id::text as id, l.ref, l.name, l.country_code, l.received_at, l.stage_code,
               (l.first_response_at is not null) as answered,
               (l.first_response_at is null and l.stage_code <> 'arrived' and l.sla_due_at < ${now.toISOString()}::timestamptz) as overdue,
               (l.assigned_admin_id is not null) as assigned,
               to_char(l.updated_at at time zone 'UTC', ${sql.raw(`'${VERSION_FORMAT}'`)}) as version,
               row_number() over (partition by l.stage_code order by l.received_at desc) as rn
          from lead l where ${where}) ranked
       where rn <= ${BOARD_COLUMN_LIMIT}
       order by received_at desc`),
    db.execute(sql`select l.stage_code, count(*)::int as n from lead l where ${where} group by 1`),
  );
  const total = new Map(rowsOf<{ stage_code: string; n: number }>(counts).map((row) => [row.stage_code, n(row.n)]));
  const byStage = new Map<string, BoardCard[]>();
  for (const row of rowsOf<Record<string, unknown>>(cards)) {
    const list = byStage.get(String(row.stage_code)) ?? [];
    list.push({
      id: String(row.id),
      ref: String(row.ref),
      name: row.name === null ? null : String(row.name),
      country: String(row.country_code),
      receivedAt: new Date(row.received_at as string).toISOString(),
      answered: row.answered === true,
      overdue: row.overdue === true,
      assigned: row.assigned === true,
      version: String(row.version),
    });
    byStage.set(String(row.stage_code), list);
  }
  return rowsOf<{ code: string; position: number; name: Record<string, string> | string }>(stages).map((stage) => ({
    code: stage.code,
    position: n(stage.position),
    name: stage.name,
    total: total.get(stage.code) ?? 0,
    cards: byStage.get(stage.code) ?? [],
  }));
}

/** The most rows one export holds. A bigger result is cut here and the response says so. */
export const EXPORT_ROW_LIMIT = 5000;

export interface ExportRow {
  ref: string;
  receivedAt: string;
  stage: string;
  country: string;
  source: string;
  intake: string;
  assigned: boolean;
  firstResponseMinutes: number | null;
  overdue: boolean;
}

/**
 * The rows of the export: references, dates, stage, country, source and timing only. No name, number or email leaves in a file (data minimisation):
 * the reference opens the lead on screen. One more row than the limit is read, so the caller can tell the file was cut.
 */
export async function exportLeads(db: Db, actor: Actor, f: CrmFilters, now: Date): Promise<{ rows: ExportRow[]; truncated: boolean }> {
  const where = leadFilter(actor, f);
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select l.ref, l.received_at, l.stage_code, l.country_code, coalesce(l.source ->> 'page', 'unknown') as source, l.intake_kind,
             (l.assigned_admin_id is not null) as assigned,
             case when l.first_response_at is null then null else extract(epoch from (l.first_response_at - l.received_at)) / 60.0 end as minutes,
             (l.first_response_at is null and l.stage_code <> 'arrived' and l.sla_due_at < ${now.toISOString()}::timestamptz) as overdue
        from lead l
       where ${where} and l.received_at >= ${f.range.start.toISOString()}::timestamptz and l.received_at < ${f.range.end.toISOString()}::timestamptz
       order by l.received_at desc
       limit ${EXPORT_ROW_LIMIT + 1}`),
  );
  const all = rowsOf<Record<string, unknown>>(result);
  return {
    truncated: all.length > EXPORT_ROW_LIMIT,
    rows: all.slice(0, EXPORT_ROW_LIMIT).map((row) => ({
      ref: String(row.ref),
      receivedAt: new Date(row.received_at as string).toISOString(),
      stage: String(row.stage_code),
      country: String(row.country_code),
      source: String(row.source),
      intake: String(row.intake_kind),
      assigned: row.assigned === true,
      firstResponseMinutes: row.minutes === null ? null : Math.round(Number(row.minutes) * 10) / 10,
      overdue: row.overdue === true,
    })),
  };
}
