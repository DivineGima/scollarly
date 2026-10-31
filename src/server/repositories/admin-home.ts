import { sql } from "drizzle-orm";
import type { PeriodWindows } from "@/modules/dashboard/periods";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * The staff Home (architecture 21.9, F18; S13.6): a few aggregates over data we already keep, in one transaction as the caller (row level
 * security is the second lock). Five statements for an admin; the owner adds one for payments and onboardings. No new table, no job.
 */

export interface HomeTotals {
  /** Leads received in this period and the one before. */
  newLeads: { value: number; previous: number };
  /** Open leads nobody has answered that are unassigned or the caller's, and how many of those are past their target. Right now: no earlier period. */
  waiting: number;
  overdue: number;
  /** Stage moves the caller made, this period and the one before. */
  stageMoves: { value: number; previous: number };
  pendingClaims: number;
  openDataRequests: number;
  /** Owner only. */
  payments: { valueCents: number; previousCents: number } | null;
  onboarded: { value: number; previous: number } | null;
}

export interface HomeActivity {
  type: string;
  at: string;
  ref: string;
  leadId: string;
}

export interface StaffHome {
  totals: HomeTotals;
  series: { day: string; n: number }[];
  activity: HomeActivity[];
}

const n = (value: unknown) => Number(value ?? 0);

export async function staffHome(db: Db, actor: Actor, w: PeriodWindows): Promise<StaffHome> {
  const owner = actor.role === "owner";
  const cur = w.curStart.toISOString();
  const prev = w.prevStart.toISOString();
  const end = w.curEnd.toISOString();
  const mine = sql`(l.assigned_admin_id is null or l.assigned_admin_id = ${actor.userId})`;
  const live = sql`l.merged_into_id is null and l.anonymised_at is null`;

  const queries = [
    db.execute(sql`
      select count(*) filter (where l.received_at >= ${cur}::timestamptz and l.received_at < ${end}::timestamptz) as new_cur,
             count(*) filter (where l.received_at >= ${prev}::timestamptz and l.received_at < ${cur}::timestamptz) as new_prev,
             count(*) filter (where l.first_response_at is null and l.stage_code <> 'arrived' and ${mine}) as waiting,
             count(*) filter (where l.first_response_at is null and l.stage_code <> 'arrived' and ${mine} and l.sla_due_at < now()) as overdue
        from lead l where ${live}`),
    db.execute(sql`
      select to_char((l.received_at + interval '1 hour')::date, 'YYYY-MM-DD') as day, count(*)::int as n
        from lead l
       where ${live} and l.received_at >= ${cur}::timestamptz and l.received_at < ${end}::timestamptz
       group by 1`),
    db.execute(sql`
      select count(*) filter (where a.created_at >= ${cur}::timestamptz and a.created_at < ${end}::timestamptz) as moves_cur,
             count(*) filter (where a.created_at >= ${prev}::timestamptz and a.created_at < ${cur}::timestamptz) as moves_prev
        from lead_activity a
       where a.type = 'stage_changed' and a.actor_id = ${actor.userId} and a.created_at >= ${prev}::timestamptz`),
    db.execute(sql`
      select (select count(*) from lead_claim where status = 'pending') as claims,
             (select count(*) from data_request where status = 'open') as requests`),
    db.execute(sql`
      select a.type, a.created_at, l.ref, l.id::text as lead_id
        from lead_activity a join lead l on l.id = a.lead_id
       order by a.created_at desc limit 8`),
    ...(owner
      ? [
          db.execute(sql`
            select coalesce(sum(p.amount_usd_cents) filter (where p.entered_at >= ${cur}::timestamptz and p.entered_at < ${end}::timestamptz), 0) as pay_cur,
                   coalesce(sum(p.amount_usd_cents) filter (where p.entered_at >= ${prev}::timestamptz and p.entered_at < ${cur}::timestamptz), 0) as pay_prev,
                   (select count(*) from student_profile sp where sp.onboarded_at >= ${cur}::timestamptz and sp.onboarded_at < ${end}::timestamptz) as onb_cur,
                   (select count(*) from student_profile sp where sp.onboarded_at >= ${prev}::timestamptz and sp.onboarded_at < ${cur}::timestamptz) as onb_prev
              from placement_payment p where p.voided_at is null`),
        ]
      : []),
  ] as const;

  const [totals, series, moves, requests, activity, money] = await runAs(db, actor, ...(queries as unknown as [Promise<unknown>, ...Promise<unknown>[]]));
  const t = rowsOf<Record<string, unknown>>(totals)[0] ?? {};
  const m = rowsOf<Record<string, unknown>>(moves)[0] ?? {};
  const r = rowsOf<Record<string, unknown>>(requests)[0] ?? {};
  const o = owner ? (rowsOf<Record<string, unknown>>(money)[0] ?? {}) : null;
  return {
    totals: {
      newLeads: { value: n(t.new_cur), previous: n(t.new_prev) },
      waiting: n(t.waiting),
      overdue: n(t.overdue),
      stageMoves: { value: n(m.moves_cur), previous: n(m.moves_prev) },
      pendingClaims: n(r.claims),
      openDataRequests: n(r.requests),
      payments: o ? { valueCents: n(o.pay_cur), previousCents: n(o.pay_prev) } : null,
      onboarded: o ? { value: n(o.onb_cur), previous: n(o.onb_prev) } : null,
    },
    series: rowsOf<{ day: string; n: number }>(series).map((row) => ({ day: row.day, n: n(row.n) })),
    activity: rowsOf<{ type: string; created_at: string | Date; ref: string; lead_id: string }>(activity).map((row) => ({ type: row.type, at: new Date(row.created_at).toISOString(), ref: row.ref, leadId: row.lead_id })),
  };
}
