import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { uuidv7 } from "@/lib/uuid";
import { runAs } from "./as-actor";

/**
 * Data requests: export and erasure (architecture 7.2, 10.8, S5.5, B5). A request comes from the student portal (Stage 8) or
 * is logged here by an admin for someone who asked on WhatsApp. An erasure request is completed by erasing the lead
 * (`eraseLead`, which marks the request done in the same transaction); an export request is completed by hand here.
 */

export type DataRequestKind = "export" | "erasure";
export type DataRequestChannel = "portal" | "whatsapp" | "other";

export interface DataRequestRow {
  id: string;
  kind: DataRequestKind;
  channel: DataRequestChannel;
  status: "open" | "done" | "rejected";
  createdAt: Date;
  completedAt: Date | null;
  handledBy: string | null;
  leadId: string | null;
  leadRef: string | null;
  leadErased: boolean;
  /** For a portal request that names the account and not a lead: the account's leads still to be handled. */
  accountLeads: { id: string; ref: string }[];
}

export const DATA_REQUEST_PAGE = 100;

export async function listDataRequests(db: Db, actor: Actor, status: "open" | "all"): Promise<DataRequestRow[]> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select d.id, d.kind, d.channel, d.status, d.created_at, d.completed_at, d.handled_by, d.lead_id,
             l.ref as lead_ref, (l.anonymised_at is not null) as lead_erased,
             (select coalesce(json_agg(json_build_object('id', x.id, 'ref', x.ref) order by x.received_at), '[]'::json)
                from lead x
               where d.lead_id is null and d.user_id is not null and x.user_id = d.user_id and x.anonymised_at is null) as account_leads
        from data_request d left join lead l on l.id = d.lead_id
       ${status === "open" ? sql`where d.status = 'open'` : sql``}
       order by (d.status = 'open') desc, d.created_at desc, d.id desc
       limit ${DATA_REQUEST_PAGE}`),
  );
  return rowsOf<{
    id: string;
    kind: DataRequestKind;
    channel: DataRequestChannel;
    status: DataRequestRow["status"];
    created_at: string | Date;
    completed_at: string | Date | null;
    handled_by: string | null;
    lead_id: string | null;
    lead_ref: string | null;
    lead_erased: boolean | null;
    account_leads: { id: string; ref: string }[] | string;
  }>(result).map((r) => ({
    id: r.id,
    kind: r.kind,
    channel: r.channel,
    status: r.status,
    createdAt: new Date(r.created_at),
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
    handledBy: r.handled_by,
    leadId: r.lead_id,
    leadRef: r.lead_ref,
    leadErased: r.lead_erased === true,
    accountLeads: typeof r.account_leads === "string" ? (JSON.parse(r.account_leads) as { id: string; ref: string }[]) : r.account_leads,
  }));
}

export type LogRequestOutcome = { kind: "ok"; id: string } | { kind: "lead_not_found" } | { kind: "lead_erased" };

/** B5 step 2. The lead is named by its reference. An erasure request for a lead that is already erased is refused (there is nothing left to erase). */
export async function logDataRequest(
  db: Db,
  actor: Actor,
  input: { kind: DataRequestKind; channel: Exclude<DataRequestChannel, "portal">; leadRef: string },
): Promise<LogRequestOutcome> {
  const id = uuidv7();
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with l as (
        select id, (anonymised_at is not null) as erased from lead where ref = ${input.leadRef}
      ), ins as (
        insert into data_request (id, kind, channel, status, lead_id)
        select ${id}::uuid, ${input.kind}, ${input.channel}, 'open', l.id from l
         where not (l.erased and ${input.kind} = 'erasure')
        returning id
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select ${uuidv7()}::uuid, ${actor.userId}, 'dataRequests.log', 'data_request', id::text,
               jsonb_build_object('kind', ${input.kind}::text, 'channel', ${input.channel}::text)
          from ins
      )
      select (select count(*) from l)::int as found, (select count(*) from ins)::int as inserted, (select bool_or(erased) from l) as erased`),
  );
  const row = rowsOf<{ found: number; inserted: number; erased: boolean | null }>(result)[0];
  if (row && row.inserted > 0) return { kind: "ok", id };
  if (!row || row.found === 0) return { kind: "lead_not_found" };
  return { kind: "lead_erased" };
}

export type CompleteRequestOutcome = "done" | "not_found" | "not_open" | "erase_first";

/**
 * B5 step 4. An erasure request whose lead is still not erased cannot be marked done by hand: it is completed by erasing the
 * lead, so "done" can never mean "nothing was erased".
 */
export async function completeDataRequest(db: Db, actor: Actor, id: string): Promise<CompleteRequestOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with d as (
        select r.id, r.status, r.kind, (r.lead_id is not null and exists (select 1 from lead l where l.id = r.lead_id and l.anonymised_at is null)) as lead_live,
               (r.lead_id is null and r.user_id is not null and exists (select 1 from lead l where l.user_id = r.user_id and l.anonymised_at is null)) as account_live
          from data_request r where r.id = ${id}::uuid
      ), upd as (
        update data_request r set status = 'done', handled_by = ${actor.userId}, completed_at = now()
          from d
         where r.id = d.id and d.status = 'open' and not (d.kind = 'erasure' and (d.lead_live or d.account_live))
        returning r.id
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select ${uuidv7()}::uuid, ${actor.userId}, 'dataRequests.complete', 'data_request', id::text, '{}'::jsonb from upd
      )
      select (select count(*) from d)::int as found, (select count(*) from upd)::int as updated,
             (select status from d) as status, (select (kind = 'erasure' and (lead_live or account_live)) from d) as needs_erasure`),
  );
  const row = rowsOf<{ found: number; updated: number; status: string | null; needs_erasure: boolean | null }>(result)[0];
  if (!row || row.found === 0) return "not_found";
  if (row.updated > 0) return "done";
  if (row.status !== "open") return "not_open";
  return row.needs_erasure ? "erase_first" : "not_open";
}
