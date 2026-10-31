import { startOfWatDay } from "@/lib/time";
import { usageOf } from "@/modules/health/service";

/**
 * Notifications (architecture 21.8, ADR-045): no table. A notification is a row of a query over data we already keep, shown as unread when it
 * is newer than the person's one `notifications_seen_at`. This file is the pure part: the kinds, the rules, and how a row becomes an item.
 */

export type NotificationKind =
  | "stage_changed"
  | "reply_logged"
  | "new_match"
  | "finish_onboarding"
  | "new_lead"
  | "sla_due"
  | "lead_waiting"
  | "link_requests"
  | "data_requests"
  | "payment"
  | "stale_content"
  | "storage";

export interface NotificationItem {
  /** Stable for the same thing, so a list keeps its keys between loads. */
  id: string;
  kind: NotificationKind;
  /** ISO time the thing happened (or, for a standing condition, the start of today in WAT). */
  at: string;
  unread: boolean;
  ref?: string;
  /** A lead's name: only in staff lists, which may read leads anyway. */
  name?: string | null;
  leadId?: string;
  /** The stage code a student's application moved to. */
  stage?: string;
  slug?: string;
  university?: string;
  count?: number;
  overdue?: boolean;
  amountUsdCents?: number;
  storage?: "database" | "images";
  level?: "warn" | "urgent";
}

/** At most this many items are returned, newest first (architecture 21.8). */
export const MAX_ITEMS = 50;
/** A lead is "due soon" this long before its reply target (architecture 21.8, [Mine, confirm]). */
export const SLA_SOON_MINUTES = 60;
/** An open lead nobody has touched for this long is "waiting too long" ([Mine, confirm]). */
export const WAITING_DAYS = 3;
/** How far back a list looks for things that happened (a standing condition is always current). */
export const LOOKBACK_DAYS = 14;

/** Unread means newer than the last time the person pressed "Mark all read"; never seen means everything is unread. */
export function isUnread(at: Date, seenAt: Date | null): boolean {
  return seenAt === null || at.getTime() > seenAt.getTime();
}

/** Newest first, at most `MAX_ITEMS`. */
export function newestFirst(items: readonly NotificationItem[]): NotificationItem[] {
  return [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : 1)).slice(0, MAX_ITEMS);
}

export function unreadCount(items: readonly NotificationItem[]): number {
  return items.filter((item) => item.unread).length;
}

/**
 * A standing condition (stale content, a nearly full store) has no moment it began that we keep, so it is dated the start of today in WAT:
 * "Mark all read" quiets it for the day and it comes back unread tomorrow while it is still true.
 */
export function standingAt(now: Date): Date {
  return startOfWatDay(now);
}

/** Whether a lead's reply target is within the next hour or already past, and how it is shown. */
export function slaAlert(dueAt: Date, now: Date): { due: boolean; overdue: boolean } {
  const overdue = dueAt.getTime() <= now.getTime();
  return { due: overdue || dueAt.getTime() - now.getTime() <= SLA_SOON_MINUTES * 60_000, overdue };
}

/** The level at which a store (the database or the images) is worth telling the owner about: from 70% (the Health banner, FR-18). */
export function storageAlert(usedBytes: number, budgetBytes: number): "warn" | "urgent" | null {
  const { level } = usageOf(usedBytes, budgetBytes);
  return level === "ok" ? null : level;
}
