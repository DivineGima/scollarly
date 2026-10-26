import { sql, type SQL } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import type { StageInfo } from "@/modules/analytics/funnel";
import { runAs } from "./as-actor";
import { teamMembersOf, teamQuery } from "./team";

/**
 * What the analytics screens read (architecture 7.5, 10.3, 16 B10; S7.2, S7.3). Staff only: row level security allows `lead`,
 * `event` and `event_daily_agg` to staff alone (migration 0003), and the performance numbers take the person from the `Actor`,
 * never from the request, so an admin can only ever see their own.
 *
 * One round trip each. The funnel joins two sources: the daily counts (anonymous, filed under WAT dates) and the leads themselves.
 * A lead that was merged into another is left out, so a duplicate is not counted twice; an erased lead stays (counts remain, 7.9).
 */

export interface AnalyticsFilter {
  /** WAT dates, inclusive. */
  from: string;
  to: string;
  /** The same range as UTC instants: `start` inclusive, `end` exclusive. */
  start: Date;
  end: Date;
  country?: string;
  universityId?: string;
}

export interface FunnelData {
  pageViews: number;
  waTaps: number;
  leadsByStage: Map<string, number>;
  stages: (StageInfo & { name: Record<string, string> | string })[];
  byCountry: { country: string; leads: number }[];
  byUniversity: { universityId: string | null; name: string | null; leads: number }[];
  byPage: { page: string | null; leads: number }[];
  /** `collect_page_views` is on. When it is off the funnel has no "visit" step to show (ADR-003). */
  collectPageViews: boolean;
  universities: { id: string; name: string }[];
  /** S9.3: payments received in the range (voided ones left out). The country filter does not apply: a payment has no country. */
  payments: { totalCents: number; count: number; byUniversity: { universityId: string; name: string; totalCents: number; count: number }[] };
}

function leadConditions(f: AnalyticsFilter): SQL {
  const parts: SQL[] = [sql`l.received_at >= ${f.start.toISOString()}::timestamptz`, sql`l.received_at < ${f.end.toISOString()}::timestamptz`, sql`l.merged_into_id is null`];
  if (f.country) parts.push(sql`l.country_code = ${f.country}`);
  if (f.universityId) parts.push(sql`l.source->>'university_id' = ${f.universityId}`);
  return sql.join(parts, sql` and `);
}

function aggConditions(f: AnalyticsFilter): SQL {
  const parts: SQL[] = [sql`a.date >= ${f.from}::date`, sql`a.date <= ${f.to}::date`];
  if (f.country) parts.push(sql`a.country = ${f.country}`);
  if (f.universityId) parts.push(sql`a.university_id = ${f.universityId}::uuid`);
  return sql.join(parts, sql` and `);
}

export async function funnelData(db: Db, actor: Actor, f: AnalyticsFilter): Promise<FunnelData> {
  const [counts, byStage, byCountry, byUniversity, byPage, setting, stages, universities, paymentRows] = await runAs(
    db,
    actor,
    db.execute(sql`select a.type, coalesce(sum(a.count), 0)::bigint as n from event_daily_agg a where ${aggConditions(f)} and a.type in ('page_view', 'wa_tap') group by a.type`),
    db.execute(sql`select l.stage_code, count(*)::int as n from lead l where ${leadConditions(f)} group by l.stage_code`),
    db.execute(sql`select l.country_code, count(*)::int as n from lead l where ${leadConditions(f)} group by l.country_code order by n desc, l.country_code`),
    db.execute(sql`
      select u.id as university_id, u.name, count(*)::int as n
        from lead l left join university u on u.id::text = l.source->>'university_id'
       where ${leadConditions(f)} group by u.id, u.name order by n desc, u.name nulls last limit 30`),
    db.execute(sql`select l.source->>'page' as page, count(*)::int as n from lead l where ${leadConditions(f)} group by 1 order by n desc, page nulls last limit 15`),
    db.execute(sql`select value from site_setting where key = 'collect_page_views'`),
    db.execute(sql`select code, position, name from pipeline_stage order by position`),
    db.execute(sql`select id, name from university order by name`),
    db.execute(sql`
      select p.university_id, u.name, sum(p.amount_usd_cents)::bigint as cents, count(*)::int as n
        from placement_payment p join university u on u.id = p.university_id
       where p.voided_at is null and p.received_on >= ${f.from}::date and p.received_on <= ${f.to}::date
         ${f.universityId ? sql`and p.university_id = ${f.universityId}::uuid` : sql``}
       group by p.university_id, u.name order by cents desc, u.name`),
  );
  const paid = rowsOf<{ university_id: string; name: string; cents: string | number; n: number }>(paymentRows).map((r) => ({ universityId: r.university_id, name: r.name, totalCents: Number(r.cents), count: r.n }));
  const sumOf = (type: string) => Number(rowsOf<{ type: string; n: string | number }>(counts).find((r) => r.type === type)?.n ?? 0);
  return {
    pageViews: sumOf("page_view"),
    waTaps: sumOf("wa_tap"),
    leadsByStage: new Map(rowsOf<{ stage_code: string; n: number }>(byStage).map((r) => [r.stage_code, r.n])),
    stages: rowsOf<{ code: string; position: number; name: Record<string, string> | string }>(stages),
    byCountry: rowsOf<{ country_code: string; n: number }>(byCountry).map((r) => ({ country: r.country_code, leads: r.n })),
    byUniversity: rowsOf<{ university_id: string | null; name: string | null; n: number }>(byUniversity).map((r) => ({ universityId: r.university_id, name: r.name, leads: r.n })),
    byPage: rowsOf<{ page: string | null; n: number }>(byPage).map((r) => ({ page: r.page, leads: r.n })),
    collectPageViews: rowsOf<{ value: unknown }>(setting)[0]?.value !== false,
    universities: rowsOf<{ id: string; name: string }>(universities),
    payments: { totalCents: paid.reduce((sum, r) => sum + r.totalCents, 0), count: paid.reduce((sum, r) => sum + r.count, 0), byUniversity: paid },
  };
}

export interface PerformanceData {
  /** Leads assigned to this person that were received in the range. */
  assigned: number;
  /** Of those, the ones with a logged first reply. */
  answered: number;
  /** Median and mean minutes from receipt to the first logged reply, for the answered ones; null when there are none. */
  medianMinutes: number | null;
  meanMinutes: number | null;
  /** Assigned to this person right now, unanswered and past the stored target. Not limited to the range: overdue is overdue. */
  overdue: number;
}

/**
 * S7.3 "My performance". The person is the `Actor`, never a parameter, so an admin cannot ask for someone else's numbers; the
 * all-admin view is a separate owner-only call (Stage 9, C3). The reply times are based on logged replies (B10 step 5), which is
 * what staff record, not when a message was actually sent on WhatsApp.
 */
export async function performanceOf(db: Db, actor: Actor, f: Pick<AnalyticsFilter, "start" | "end">, now: Date): Promise<PerformanceData> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select count(*)::int as assigned,
             count(*) filter (where l.first_response_at is not null)::int as answered,
             percentile_cont(0.5) within group (order by extract(epoch from (l.first_response_at - l.received_at)) / 60.0) filter (where l.first_response_at is not null) as median_minutes,
             avg(extract(epoch from (l.first_response_at - l.received_at)) / 60.0) filter (where l.first_response_at is not null) as mean_minutes,
             (select count(*)::int from lead o where o.assigned_admin_id = ${actor.userId} and o.merged_into_id is null and o.anonymised_at is null
                 and o.first_response_at is null and o.sla_due_at < ${now.toISOString()}::timestamptz) as overdue
        from lead l
       where l.assigned_admin_id = ${actor.userId} and l.merged_into_id is null
         and l.received_at >= ${f.start.toISOString()}::timestamptz and l.received_at < ${f.end.toISOString()}::timestamptz`),
  );
  const row = rowsOf<{ assigned: number; answered: number; median_minutes: string | number | null; mean_minutes: string | number | null; overdue: number }>(result)[0];
  const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v)));
  return { assigned: row?.assigned ?? 0, answered: row?.answered ?? 0, medianMinutes: num(row?.median_minutes), meanMinutes: num(row?.mean_minutes), overdue: row?.overdue ?? 0 };
}

export interface AdminPerformance extends PerformanceData {
  userId: string;
  email: string;
  name: string;
  role: "admin" | "owner";
}

/**
 * C3 (S9.4): every admin's numbers side by side. The owner only: the endpoint refuses anyone else, and `performanceOf` stays the only way an
 * admin can read performance, always their own. Same definitions as `performanceOf`, grouped by the assigned person; an admin with no leads
 * in the range still has a row (zeros), so a quiet admin is visible.
 */
export async function performanceOfAll(db: Db, actor: Actor, f: Pick<AnalyticsFilter, "start" | "end">, now: Date): Promise<AdminPerformance[]> {
  const [stats, team] = await runAs(
    db,
    actor,
    db.execute(sql`
      select a.id as user_id,
             count(l.id)::int as assigned,
             count(l.id) filter (where l.first_response_at is not null)::int as answered,
             percentile_cont(0.5) within group (order by extract(epoch from (l.first_response_at - l.received_at)) / 60.0) filter (where l.first_response_at is not null) as median_minutes,
             avg(extract(epoch from (l.first_response_at - l.received_at)) / 60.0) filter (where l.first_response_at is not null) as mean_minutes,
             (select count(*)::int from lead o where o.assigned_admin_id = a.id and o.merged_into_id is null and o.anonymised_at is null
                 and o.first_response_at is null and o.sla_due_at < ${now.toISOString()}::timestamptz) as overdue
        from app_user a
        left join lead l on l.assigned_admin_id = a.id and l.merged_into_id is null
                        and l.received_at >= ${f.start.toISOString()}::timestamptz and l.received_at < ${f.end.toISOString()}::timestamptz
       where a.role in ('admin', 'owner')
       group by a.id`),
    teamQuery(db),
  );
  const byId = new Map(rowsOf<{ user_id: string; assigned: number; answered: number; median_minutes: string | number | null; mean_minutes: string | number | null; overdue: number }>(stats).map((r) => [r.user_id, r]));
  const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v)));
  return teamMembersOf(team).map((m) => {
    const r = byId.get(m.userId);
    return { userId: m.userId, email: m.email, name: m.name, role: m.role, assigned: r?.assigned ?? 0, answered: r?.answered ?? 0, medianMinutes: num(r?.median_minutes), meanMinutes: num(r?.mean_minutes), overdue: r?.overdue ?? 0 };
  });
}
