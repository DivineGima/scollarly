import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * The student portal's reads and writes (architecture 9.6, 10.8, 16 A11 to A13; S8.1 to S8.3). A student reads only what row level
 * security lets a student read: their own leads (`lead.user_id` = them), their own link requests, the six stage names and the
 * public WhatsApp setting. Nothing else is reachable, whatever this code asks for, and a student can never read another
 * student's lead (the Stage 8 exit criterion, proven in tests/integration/stage8-student.test.ts).
 *
 * The writes that need more than a student may do (create a link request for a lead they do not own yet, log an export, erase the
 * account) are SECURITY DEFINER functions of migration 0009 that read the caller from the row level security context.
 */

export interface StageName {
  code: string;
  position: number;
  name: Record<string, string> | string;
}

export interface MyLead {
  id: string;
  ref: string;
  stageCode: string;
  /** The lead's `updated_at`: the last time anything on it changed (a stage move, an assignment). */
  updatedAt: Date;
}

export interface Progress {
  leads: MyLead[];
  stages: StageName[];
  /** Link requests waiting for an admin. */
  pendingClaims: number;
  /** The Scollarly WhatsApp number from the settings (E.164), or null when it is not set. */
  whatsappE164: string | null;
}

export async function progressOf(db: Db, actor: Actor): Promise<Progress> {
  const [leads, stages, claims, setting] = await runAs(
    db,
    actor,
    db.execute(sql`
      select l.id, l.ref, l.stage_code, l.updated_at
        from lead l
       where l.user_id = ${actor.userId} and l.anonymised_at is null and l.merged_into_id is null
       order by l.received_at desc limit 5`),
    db.execute(sql`select code, position, name from pipeline_stage order by position`),
    db.execute(sql`select count(*)::int as n from lead_claim c where c.user_id = ${actor.userId} and c.status = 'pending'`),
    db.execute(sql`select value from site_setting where key = 'whatsapp_number_e164'`),
  );
  const number = rowsOf<{ value: unknown }>(setting)[0]?.value;
  return {
    leads: rowsOf<{ id: string; ref: string; stage_code: string; updated_at: string | Date }>(leads).map((l) => ({ id: l.id, ref: l.ref, stageCode: l.stage_code, updatedAt: new Date(l.updated_at) })),
    stages: rowsOf<StageName>(stages),
    pendingClaims: rowsOf<{ n: number }>(claims)[0]?.n ?? 0,
    whatsappE164: typeof number === "string" ? number : null,
  };
}

export type RequestLinkOutcome = "sent" | "rate_limited";

/** Creates a pending link request for any lead that matches. The answer is the same whether or not one did (architecture 9.6). */
export async function requestLink(db: Db, actor: Actor, input: { ref: string } | { number: string }): Promise<RequestLinkOutcome> {
  const ref = "ref" in input ? input.ref : null;
  const number = "number" in input ? input.number : null;
  const [result] = await runAs(db, actor, db.execute(sql`select public.app_request_link(${ref}, ${number}) as outcome`));
  return rowsOf<{ outcome: RequestLinkOutcome }>(result)[0]?.outcome ?? "sent";
}

export interface MyExport {
  leads: {
    ref: string;
    clientRef: string;
    name: string | null;
    whatsapp: string | null;
    email: string | null;
    country: string;
    intakeKind: string;
    qualificationType: string | null;
    results: unknown;
    stage: string;
    programmes: { rank: number; programme: string | null }[];
    receivedAt: string;
    updatedAt: string;
    consent: { noticeVersion: string; at: string };
  }[];
  linkRequests: { method: string; status: string; requestedAt: string; decidedAt: string | null }[];
}

/**
 * S8.3 / A13 step 2: the student's own data, generated on request. Reading it and logging that it was read (a done `data_request`
 * and an audit row) happen in one transaction, so there is never an export without a record or a record without an export.
 * Staff notes are not included: they are the team's working notes about the lead, not data the student gave.
 */
export async function exportMyData(db: Db, actor: Actor): Promise<MyExport> {
  const [, leads, prefs, claims] = await runAs(
    db,
    actor,
    db.execute(sql`select public.app_log_my_export()`),
    db.execute(sql`
      select l.id, l.ref, l.client_ref, l.name, l.whatsapp_e164, l.email, l.country_code, l.intake_kind, l.qualification_type, l.results,
             l.stage_code, l.received_at, l.updated_at, l.consent_notice_version, l.consent_at
        from lead l where l.user_id = ${actor.userId} order by l.received_at`),
    db.execute(sql`
      select p.lead_id, p.rank, pr.name
        from lead_programme_pref p join lead l on l.id = p.lead_id left join programme pr on pr.id = p.programme_id
       where l.user_id = ${actor.userId} order by p.lead_id, p.rank`),
    db.execute(sql`select c.method, c.status, c.created_at, c.decided_at from lead_claim c where c.user_id = ${actor.userId} order by c.created_at`),
  );
  const programmes = rowsOf<{ lead_id: string; rank: number; name: string | null }>(prefs);
  const iso = (v: string | Date) => new Date(v).toISOString();
  return {
    leads: rowsOf<{
      id: string;
      ref: string;
      client_ref: string;
      name: string | null;
      whatsapp_e164: string | null;
      email: string | null;
      country_code: string;
      intake_kind: string;
      qualification_type: string | null;
      results: unknown;
      stage_code: string;
      received_at: string | Date;
      updated_at: string | Date;
      consent_notice_version: string;
      consent_at: string | Date;
    }>(leads).map((l) => ({
      ref: l.ref,
      clientRef: l.client_ref,
      name: l.name,
      whatsapp: l.whatsapp_e164,
      email: l.email,
      country: l.country_code,
      intakeKind: l.intake_kind,
      qualificationType: l.qualification_type,
      results: l.results,
      stage: l.stage_code,
      programmes: programmes.filter((p) => p.lead_id === l.id).map((p) => ({ rank: p.rank, programme: p.name })),
      receivedAt: iso(l.received_at),
      updatedAt: iso(l.updated_at),
      consent: { noticeVersion: l.consent_notice_version, at: iso(l.consent_at) },
    })),
    linkRequests: rowsOf<{ method: string; status: string; created_at: string | Date; decided_at: string | Date | null }>(claims).map((c) => ({
      method: c.method,
      status: c.status,
      requestedAt: iso(c.created_at),
      decidedAt: c.decided_at ? iso(c.decided_at) : null,
    })),
  };
}

export type EraseOutcome = "erased" | "reauth_required" | "staff_account" | "not_found";

/** S8.3 / A13 step 3. Everything happens in the database function, in one transaction (migration 0009). */
export async function eraseMyAccount(db: Db, actor: Actor, sessionToken: string): Promise<EraseOutcome> {
  const [result] = await runAs(db, actor, db.execute(sql`select public.app_erase_my_account(${sessionToken}) as outcome`));
  return rowsOf<{ outcome: EraseOutcome }>(result)[0]?.outcome ?? "not_found";
}
