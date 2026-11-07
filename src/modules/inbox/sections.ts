/**
 * The Inbox (architecture 24.9, ADR-069, PRD_5 FR-51): the sections a manager or an admin works through, ordered by what needs action. Pure: the
 * keys, who sees which, and the rules that are numbers, so a test can hold them. The queries are in `server/repositories/inbox.ts`.
 */

export const INBOX_SECTIONS = ["new", "to_review", "overdue", "letter_ready", "payment_proof", "quiet", "unassigned"] as const;
export type InboxSection = (typeof INBOX_SECTIONS)[number];

/** The Admin's own section: a student with no manager (every manager was away, or the manager was removed). A manager never sees it. */
export const ADMIN_ONLY_SECTIONS: readonly InboxSection[] = ["unassigned"];

/** The sections a role is shown, in order. */
export function sectionsFor(role: "manager" | "admin"): readonly InboxSection[] {
  return role === "admin" ? INBOX_SECTIONS : INBOX_SECTIONS.filter((s) => !ADMIN_ONLY_SECTIONS.includes(s));
}

/** At most this many rows of one section are returned; the count says how many there are in all. */
export const INBOX_ROW_LIMIT = 50;

/** A letter is "ready" until staff have been in touch with the student (a reply or a WhatsApp opened) after it was uploaded. */
export const LETTER_CONTACT_ACTIVITIES = ["reply_logged", "admin_wa_opened"] as const;

export interface InboxRow {
  id: string;
  ref: string;
  name: string | null;
  stageCode: string;
  /** ISO time the thing in this section began (first received, oldest waiting document, clock due, last student action...). */
  at: string;
  /** Documents waiting, for the two document sections. */
  waiting: number | null;
  /** Whole days since the student last did anything, for the Quiet section. */
  idleDays: number | null;
}

export interface InboxResult {
  section: InboxSection;
  counts: Record<InboxSection, number>;
  rows: InboxRow[];
  /** True when more rows exist than were returned. */
  more: boolean;
}

/** The daily summary line of the Inbox header: how many students need an action, each student counted once per section they are in. */
export function totalNeedingAction(counts: Record<InboxSection, number>, role: "manager" | "admin"): number {
  return sectionsFor(role).reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

export function isInboxSection(value: string): value is InboxSection {
  return (INBOX_SECTIONS as readonly string[]).includes(value);
}
