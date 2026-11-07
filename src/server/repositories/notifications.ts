import { sql } from "drizzle-orm";
import { isUnread, LOOKBACK_DAYS, newestFirst, slaAlert, SLA_SOON_MINUTES, standingAt, storageAlert, WAITING_DAYS, type NotificationItem } from "@/modules/notifications/items";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";
import { UNIVERSITY_CLOCK_DAYS } from "@/modules/pipeline/steps";
import { staleItemsOf, staleQuery } from "./content-admin";
import { DEFAULT_MEDIA_BUDGET_BYTES } from "./media-admin";
import { DATABASE_BUDGET_BYTES } from "@/modules/health/service";

/**
 * Notifications (architecture 21.8, ADR-045; S13.5). Each person's list is derived from rows we already keep, in one transaction, as the
 * caller, so row level security is the second lock: a student reads only their own lead's items (through the SECURITY DEFINER function
 * `app_my_notifications`, migration 0015, because a student cannot read `lead_activity`), and staff read what staff may read. "Mark all
 * read" moves only the caller's own `notifications_seen_at` (`app_mark_notifications_seen`, migration 0013).
 *
 * Student: two queries. Admin: three. Owner: three more (payments, stale content, the two stores), so the owner's call is six statements in
 * one round trip. (The design said at most three queries; the owner's extra items are the owner-only ones, recorded in the architecture.)
 */

const dateOrNull = (value: string | Date | null | undefined) => (value ? new Date(value) : null);

interface SeenRow {
  notifications_seen_at: string | Date | null;
  account_confirmed_at: string | Date | null;
  onboarded: boolean;
}

export interface NotificationList {
  items: NotificationItem[];
  unread: number;
}

const finish = (items: NotificationItem[]): NotificationList => {
  const sorted = newestFirst(items);
  return { items: sorted, unread: sorted.filter((item) => item.unread).length };
};

/** The student's items: stage changes and adviser replies on their own application, new universities for their courses, the onboarding reminder. */
export async function studentNotifications(db: Db, actor: Actor, now: Date = new Date()): Promise<NotificationList> {
  const [seen, mine] = await runAs(
    db,
    actor,
    db.execute(sql`
      select a.notifications_seen_at, a.account_confirmed_at, (sp.user_id is not null) as onboarded
        from app_user a left join student_profile sp on sp.user_id = a.id
       where a.id = ${actor.userId}`),
    db.execute(sql`select kind, at, ref, detail from public.app_my_notifications()`),
  );
  const user = rowsOf<SeenRow>(seen)[0];
  const seenAt = dateOrNull(user?.notifications_seen_at);
  const items: NotificationItem[] = rowsOf<{ kind: string; at: string | Date; ref: string | null; detail: string | null }>(mine).flatMap((row): NotificationItem[] => {
    const at = new Date(row.at);
    const base = { at: at.toISOString(), unread: isUnread(at, seenAt) };
    switch (row.kind) {
      case "stage_changed":
        return [{ ...base, id: `stage_changed:${row.ref}:${base.at}`, kind: "stage_changed", ...(row.ref ? { ref: row.ref } : {}), ...(row.detail ? { stage: row.detail } : {}) }];
      case "reply_logged":
        return [{ ...base, id: `reply_logged:${row.ref}:${base.at}`, kind: "reply_logged", ...(row.ref ? { ref: row.ref } : {}) }];
      case "new_match":
        return row.ref ? [{ ...base, id: `new_match:${row.ref}`, kind: "new_match", slug: row.ref, ...(row.detail ? { university: row.detail } : {}) }] : [];
      default:
        return [];
    }
  });
  // The reminder is dated when the account was made, so "Mark all read" quiets it, and it stays on the list until they finish.
  if (user && !user.onboarded) {
    const at = dateOrNull(user.account_confirmed_at) ?? now;
    items.push({ id: "finish_onboarding", kind: "finish_onboarding", at: at.toISOString(), unread: isUnread(at, seenAt) });
  }
  return finish(items);
}

interface LeadRow {
  kind: "new_lead" | "sla_due" | "lead_waiting";
  lead_id: string;
  ref: string;
  name: string | null;
  at: string | Date;
}

/**
 * An admin's items: new leads, leads due soon or overdue, leads waiting too long, and the link and data requests waiting. The owner also gets
 * payments recorded, stale fees and tours, and the two stores at 70% or more. A lead is shown to an admin when it is unassigned or theirs.
 */
export async function staffNotifications(db: Db, actor: Actor, now: Date = new Date()): Promise<NotificationList> {
  const owner = actor.role === "admin";
  const mine = sql`(l.assigned_manager_id is null or l.assigned_manager_id = ${actor.userId})`;
  const live = sql`l.merged_into_id is null and l.anonymised_at is null`;
  // Fixed numbers from the constants, never from a request, so writing them into the statement is safe.
  const lookback = sql.raw(`interval '${LOOKBACK_DAYS} days'`);
  const soon = sql.raw(`interval '${SLA_SOON_MINUTES} minutes'`);
  const waiting = sql.raw(`interval '${WAITING_DAYS} days'`);
  const universityClock = sql.raw(`interval '${UNIVERSITY_CLOCK_DAYS} days'`);
  const queries = [
    db.execute(sql`select notifications_seen_at from app_user where id = ${actor.userId}`),
    db.execute(sql`
      (select 'new_lead' as kind, l.id::text as lead_id, l.ref, l.name, l.received_at as at
         from lead l where l.received_at > now() - ${lookback} and ${live} and ${mine}
        order by l.received_at desc limit 20)
      union all
      (select 'sla_due', l.id::text, l.ref, l.name, l.sla_due_at
         from lead l
        where l.first_response_at is null and l.stage_code <> 'arrived' and ${live} and ${mine}
          and l.sla_due_at <= now() + ${soon} and l.sla_due_at > now() - ${lookback}
        order by l.sla_due_at desc limit 20)
      union all
      (select 'lead_waiting', l.id::text, l.ref, l.name, l.last_activity_at + ${waiting}
         from lead l
        where l.stage_code <> 'arrived' and ${live} and ${mine}
          and l.last_activity_at < now() - ${waiting} and l.last_activity_at > now() - interval '30 days'
        order by l.last_activity_at desc limit 10)`),
    db.execute(sql`
      select 'link_requests' as kind, count(*)::int as n, max(created_at) as at from lead_claim where status = 'pending'
      union all
      select 'data_requests', count(*)::int, max(created_at) from data_request where status = 'open'`),
    // Version 5 (architecture 24.10): what is waiting on a staff member. Row level security limits a manager to their own students; the Admin sees all.
    db.execute(sql`
      with open_leads as (select l.id, l.user_id, l.ref, l.name, l.stage_code, l.university_submitted_at, l.received_at, l.assigned_manager_id from lead l where l.status = 'open' and ${live})
      (select 'docs_review' as kind, o.id::text as lead_id, o.ref, o.name, max(d.created_at) as at, count(*)::int as n
         from open_leads o join student_document d on d.student_id = o.user_id and d.state = 'uploaded' and d.kind in ('results', 'id', 'birth_certificate', 'signature', 'passport')
        group by o.id, o.ref, o.name order by max(d.created_at) desc limit 20)
      union all
      (select 'letter_ready', o.id::text, o.ref, o.name, max(d.created_at), 1
         from open_leads o join student_document d on d.student_id = o.user_id and d.state in ('uploaded', 'approved') and d.kind in ('offer_letter', 'acceptance_letter') and d.created_at > now() - ${lookback}
        where d.created_at > coalesce((select max(a.created_at) from lead_activity a where a.lead_id = o.id and a.type in ('reply_logged', 'admin_wa_opened')), 'epoch'::timestamptz)
        group by o.id, o.ref, o.name order by max(d.created_at) desc limit 20)
      union all
      (select 'proof_waiting', o.id::text, o.ref, o.name, max(d.created_at), 1
         from open_leads o join student_document d on d.student_id = o.user_id and d.state = 'uploaded' and d.kind = 'payment_proof'
        group by o.id, o.ref, o.name order by max(d.created_at) desc limit 20)
      union all
      (select 'overdue', o.id::text, o.ref, o.name, o.university_submitted_at + ${universityClock}, 1
         from open_leads o where o.stage_code = 'university_review' and o.university_submitted_at is not null and o.university_submitted_at + ${universityClock} < now()
        order by o.university_submitted_at desc limit 20)
      union all
      (select 'unassigned', o.id::text, o.ref, o.name, o.received_at, 1
         from open_leads o where o.assigned_manager_id is null order by o.received_at desc limit 20)`),
    ...(owner
      ? [
          db.execute(sql`
            select p.id::text as id, p.amount_usd_cents, p.entered_at, u.name as university
              from placement_payment p left join university u on u.id = p.university_id
             where p.voided_at is null and p.approved_at is not null and p.entered_at > now() - ${lookback}
             order by p.entered_at desc limit 10`),
          staleQuery(db),
          db.execute(sql`select * from public.app_usage_snapshot()`),
          db.execute(sql`select value from site_setting where key = 'media_budget_bytes'`),
        ]
      : []),
  ] as const;

  const [seen, leads, requests, waitingOnYou, payments, stale, usage, budget] = await runAs(db, actor, ...(queries as unknown as [Promise<unknown>, ...Promise<unknown>[]]));
  const seenAt = dateOrNull(rowsOf<{ notifications_seen_at: string | Date | null }>(seen)[0]?.notifications_seen_at);
  const items: NotificationItem[] = [];

  for (const row of rowsOf<LeadRow>(leads)) {
    // A reply due in the next hour is dated when it came into that hour (its target minus the hour), which is already in the past: so "Mark all
    // read" quiets it, and it turns unread again when it becomes overdue (its target time is then later than the last time the person looked).
    const due = new Date(row.at);
    const at = row.kind === "sla_due" && due.getTime() > now.getTime() ? new Date(due.getTime() - SLA_SOON_MINUTES * 60_000) : due;
    const base = { at: at.toISOString(), unread: isUnread(at, seenAt), leadId: row.lead_id, ref: row.ref, name: row.name };
    if (row.kind === "sla_due") items.push({ ...base, id: `sla_due:${row.lead_id}`, kind: "sla_due", overdue: slaAlert(due, now).overdue });
    else items.push({ ...base, id: `${row.kind}:${row.lead_id}`, kind: row.kind });
  }

  for (const row of rowsOf<{ kind: "link_requests" | "data_requests"; n: number; at: string | Date | null }>(requests)) {
    if (row.n > 0 && row.at) {
      const at = new Date(row.at);
      items.push({ id: row.kind, kind: row.kind, at: at.toISOString(), unread: isUnread(at, seenAt), count: row.n });
    }
  }

  for (const row of rowsOf<{ kind: "docs_review" | "letter_ready" | "proof_waiting" | "overdue" | "unassigned"; lead_id: string; ref: string; name: string | null; at: string | Date; n: number }>(waitingOnYou)) {
    const at = new Date(row.at);
    items.push({ id: `${row.kind}:${row.lead_id}`, kind: row.kind, at: at.toISOString(), unread: isUnread(at, seenAt), leadId: row.lead_id, ref: row.ref, name: row.name, ...(row.kind === "docs_review" ? { count: Number(row.n) } : {}) });
  }

  if (owner) {
    for (const row of rowsOf<{ id: string; amount_usd_cents: string | number; entered_at: string | Date; university: string | null }>(payments)) {
      const at = new Date(row.entered_at);
      items.push({ id: `payment:${row.id}`, kind: "payment", at: at.toISOString(), unread: isUnread(at, seenAt), amountUsdCents: Number(row.amount_usd_cents), ...(row.university ? { university: row.university } : {}) });
    }
    const today = standingAt(now);
    const staleCount = staleItemsOf(stale).length;
    if (staleCount > 0) items.push({ id: "stale_content", kind: "stale_content", at: today.toISOString(), unread: isUnread(today, seenAt), count: staleCount });
    const u = rowsOf<{ db_bytes: string | number; image_bytes: string | number; image_budget: string | number }>(usage)[0];
    const rawBudget = rowsOf<{ value: unknown }>(budget)[0]?.value;
    const stores: [NotificationItem["storage"], number, number][] = [
      ["database", Number(u?.db_bytes ?? 0), DATABASE_BUDGET_BYTES],
      ["images", Number(u?.image_bytes ?? 0), typeof rawBudget === "number" && rawBudget > 0 ? rawBudget : DEFAULT_MEDIA_BUDGET_BYTES],
    ];
    for (const [storage, used, limit] of stores) {
      const level = storageAlert(used, limit);
      if (level) items.push({ id: `storage:${storage}`, kind: "storage", at: today.toISOString(), unread: isUnread(today, seenAt), storage, level });
    }
  }
  return finish(items);
}

/** "Mark all read": moves the caller's own last-seen time to now (`app_mark_notifications_seen`). */
export async function markNotificationsSeen(db: Db, actor: Actor): Promise<void> {
  await runAs(db, actor, db.execute(sql`select public.app_mark_notifications_seen()`));
}
