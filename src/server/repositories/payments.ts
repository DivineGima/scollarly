import { sql, type SQL } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";
import { teamMembersOf, teamQuery } from "./team";

/**
 * The payments-received ledger (architecture 7.6, 10.6, 16 B9; S9.1). Staff only: row level security allows staff to read and to insert
 * (as themselves), and the database allows an UPDATE of the three void columns and nothing else (migration 0011), so a payment cannot
 * be edited, only voided. Nothing is deleted. Each write is ONE statement together with its audit row, so both commit or neither does.
 *
 * Totals count only payments that are not voided. Money is whole US cents.
 */

export interface PaymentFilter {
  universityId?: string;
  /** Dates received, inclusive. */
  from?: string;
  to?: string;
  status?: "all" | "active" | "voided";
}

export interface PaymentRow {
  id: string;
  universityId: string;
  universityName: string;
  leadId: string | null;
  leadRef: string | null;
  amountUsdCents: number;
  receivedOn: string;
  note: string | null;
  enteredBy: string;
  enteredByEmail: string | null;
  enteredAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface PaymentTotals {
  grandTotalCents: number;
  count: number;
  byUniversity: { universityId: string; name: string; totalCents: number; count: number }[];
  /** `YYYY-MM`, newest first. */
  byMonth: { month: string; totalCents: number; count: number }[];
}

export interface PaymentList {
  rows: PaymentRow[];
  truncated: boolean;
  totals: PaymentTotals;
  universities: { id: string; name: string }[];
}

export const PAYMENT_LIST_LIMIT = 200;
export const PAYMENT_EXPORT_LIMIT = 5000;

/** The date and university range, shared by the rows and the totals. */
function rangeConditions(f: PaymentFilter): SQL[] {
  const parts: SQL[] = [];
  if (f.universityId) parts.push(sql`p.university_id = ${f.universityId}::uuid`);
  if (f.from) parts.push(sql`p.received_on >= ${f.from}::date`);
  if (f.to) parts.push(sql`p.received_on <= ${f.to}::date`);
  return parts;
}

const whereOf = (parts: SQL[]) => (parts.length ? sql`where ${sql.join(parts, sql` and `)}` : sql``);

interface RawPayment {
  id: string;
  university_id: string;
  university_name: string;
  lead_id: string | null;
  lead_ref: string | null;
  amount_usd_cents: string | number;
  received_on: string;
  note: string | null;
  entered_by: string;
  entered_at: string | Date;
  voided_at: string | Date | null;
  void_reason: string | null;
}

function rowsQuery(db: Db, f: PaymentFilter, limit: number) {
  const parts = rangeConditions(f);
  if (f.status === "active") parts.push(sql`p.voided_at is null`);
  if (f.status === "voided") parts.push(sql`p.voided_at is not null`);
  return db.execute(sql`
    select p.id, p.university_id, u.name as university_name, p.lead_id, l.ref as lead_ref, p.amount_usd_cents, p.received_on::text as received_on,
           p.note, p.entered_by, p.entered_at, p.voided_at, p.void_reason
      from placement_payment p
      join university u on u.id = p.university_id
      left join lead l on l.id = p.lead_id
      ${whereOf(parts)}
     order by p.received_on desc, p.entered_at desc, p.id desc
     limit ${limit + 1}`);
}

function rowsOfPayments(result: unknown, team: Map<string, string>, limit: number): { rows: PaymentRow[]; truncated: boolean } {
  const all = rowsOf<RawPayment>(result);
  return {
    truncated: all.length > limit,
    rows: all.slice(0, limit).map((r) => ({
      id: r.id,
      universityId: r.university_id,
      universityName: r.university_name,
      leadId: r.lead_id,
      leadRef: r.lead_ref,
      amountUsdCents: Number(r.amount_usd_cents),
      receivedOn: r.received_on,
      note: r.note,
      enteredBy: r.entered_by,
      enteredByEmail: team.get(r.entered_by) ?? null,
      enteredAt: new Date(r.entered_at).toISOString(),
      voidedAt: r.voided_at ? new Date(r.voided_at).toISOString() : null,
      voidReason: r.void_reason,
    })),
  };
}

/** B9 steps 1 and 6: the rows (newest first), the totals and the lists the form needs, in one round trip. */
export async function listPayments(db: Db, actor: Actor, filter: PaymentFilter): Promise<PaymentList> {
  const [rows, totals, universities, team] = await runAs(
    db,
    actor,
    rowsQuery(db, filter, PAYMENT_LIST_LIMIT),
    db.execute(sql`
      select p.university_id, u.name, to_char(p.received_on, 'YYYY-MM') as month, sum(p.amount_usd_cents)::bigint as cents, count(*)::int as n
        from placement_payment p join university u on u.id = p.university_id
        ${whereOf([...rangeConditions(filter), sql`p.voided_at is null`])}
       group by p.university_id, u.name, month`),
    db.execute(sql`select id, name from university order by name`),
    teamQuery(db),
  );
  const people = new Map(teamMembersOf(team).map((m) => [m.userId, m.email]));

  const cells = rowsOf<{ university_id: string; name: string; month: string; cents: string | number; n: number }>(totals);
  const byUniversity = new Map<string, PaymentTotals["byUniversity"][number]>();
  const byMonth = new Map<string, PaymentTotals["byMonth"][number]>();
  let grand = 0;
  let count = 0;
  for (const cell of cells) {
    const cents = Number(cell.cents);
    grand += cents;
    count += cell.n;
    const u = byUniversity.get(cell.university_id) ?? { universityId: cell.university_id, name: cell.name, totalCents: 0, count: 0 };
    u.totalCents += cents;
    u.count += cell.n;
    byUniversity.set(cell.university_id, u);
    const m = byMonth.get(cell.month) ?? { month: cell.month, totalCents: 0, count: 0 };
    m.totalCents += cents;
    m.count += cell.n;
    byMonth.set(cell.month, m);
  }
  return {
    ...rowsOfPayments(rows, people, PAYMENT_LIST_LIMIT),
    totals: {
      grandTotalCents: grand,
      count,
      byUniversity: [...byUniversity.values()].sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name)),
      byMonth: [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)),
    },
    universities: rowsOf<{ id: string; name: string }>(universities),
  };
}

/** B9 step 6: every row of the filter (up to the export limit), for the CSV. */
export async function exportPayments(db: Db, actor: Actor, filter: PaymentFilter): Promise<{ rows: PaymentRow[]; truncated: boolean }> {
  const [rows, team] = await runAs(db, actor, rowsQuery(db, filter, PAYMENT_EXPORT_LIMIT), teamQuery(db));
  return rowsOfPayments(rows, new Map(teamMembersOf(team).map((m) => [m.userId, m.email])), PAYMENT_EXPORT_LIMIT);
}

/** B9 step 2: the lead picker. A reference or a name; merged and erased leads are left out. */
export async function searchLeadsForPayment(db: Db, actor: Actor, q: string): Promise<{ id: string; ref: string; name: string }[]> {
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select id, ref, name from lead
       where merged_into_id is null and anonymised_at is null and (ref ilike ${like} or name ilike ${like})
       order by received_at desc limit 8`),
  );
  return rowsOf<{ id: string; ref: string; name: string }>(result);
}

export interface NewPayment {
  id: string;
  submissionToken: string;
  universityId: string;
  leadId: string | null;
  amountUsdCents: number;
  receivedOn: string;
  note: string | null;
}

export type RecordOutcome = { kind: "created"; id: string } | { kind: "replayed"; id: string } | { kind: "token_reused" };

/**
 * B9 step 3. One statement: the row and its audit row, or neither. A second call with the same submission token inserts nothing
 * (`on conflict do nothing`) and reports the first one as `replayed`, provided it carries the same facts; the same token with different
 * facts is `token_reused`, because a token is made when the form opens and a new payment needs a new one.
 * A university or lead that does not exist raises a foreign key error (23503), which the endpoint turns into a field error.
 */
type ExistingPayment = { id: string; university_id: string; lead_id: string | null; amount_usd_cents: string | number; received_on: string; note: string | null };

/** The columns that decide whether a repeated submission carries the same facts as the stored payment. */
const existingByToken = (token: string) => sql`
  select id, university_id, lead_id, amount_usd_cents, received_on::text as received_on, note
    from placement_payment where submission_token = ${token}::uuid`;

export async function recordPayment(db: Db, actor: Actor, p: NewPayment): Promise<RecordOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with ins as (
        insert into placement_payment (id, submission_token, university_id, lead_id, amount_usd_cents, received_on, note, entered_by)
        values (${p.id}::uuid, ${p.submissionToken}::uuid, ${p.universityId}::uuid, ${p.leadId}::uuid, ${p.amountUsdCents}::bigint, ${p.receivedOn}::date, ${p.note}::text, ${actor.userId})
        on conflict (submission_token) do nothing
        returning id, university_id, amount_usd_cents
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'payments.record', 'placement_payment', ins.id::text,
               jsonb_build_object('university_id', ins.university_id, 'amount_usd_cents', ins.amount_usd_cents)
          from ins
      )
      select (select id from ins) as inserted,
             (select to_jsonb(e) from (${existingByToken(p.submissionToken)}) e) as existing`),
  );
  const row = rowsOf<{ inserted: string | null; existing: ExistingPayment | null }>(result)[0];
  if (row?.inserted) return { kind: "created", id: row.inserted };
  let e = row?.existing ?? null;
  if (!e) {
    // The same token can be in flight twice (a double tap, a retry): the other request's row was committed after this statement took its
    // snapshot, so the lookup above could not see it although `on conflict` did. A new statement has a new snapshot and does.
    const [again] = await runAs(db, actor, db.execute(sql`select to_jsonb(e) as existing from (${existingByToken(p.submissionToken)}) e`));
    e = rowsOf<{ existing: ExistingPayment | null }>(again)[0]?.existing ?? null;
  }
  if (!e) return { kind: "token_reused" };
  const same = e.university_id === p.universityId && (e.lead_id ?? null) === p.leadId && Number(e.amount_usd_cents) === p.amountUsdCents && e.received_on === p.receivedOn && (e.note ?? null) === p.note;
  return same ? { kind: "replayed", id: e.id } : { kind: "token_reused" };
}

export type VoidOutcome = "ok" | "not_found" | "already_voided";

/** B9 steps 4 and 5. The reason is stored on the row; the audit row carries only the id (a reason is free text). */
export async function voidPayment(db: Db, actor: Actor, id: string, reason: string): Promise<VoidOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with upd as (
        update placement_payment set voided_at = now(), voided_by = ${actor.userId}, void_reason = ${reason}
         where id = ${id}::uuid and voided_at is null
        returning id
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'payments.void', 'placement_payment', upd.id::text, '{}'::jsonb from upd
      )
      select (select count(*) from upd)::int as voided,
             (select voided_at is not null from placement_payment where id = ${id}::uuid) as was_voided`),
  );
  const row = rowsOf<{ voided: number; was_voided: boolean | null }>(result)[0];
  if (row && row.voided > 0) return "ok";
  if (!row || row.was_voided === null) return "not_found";
  return "already_voided";
}
