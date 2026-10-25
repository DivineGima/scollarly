import { DAY_MS, startOfWatDay } from "@/lib/time";
import { slaStatus, type SlaStatus } from "@/modules/sla/service";
import type { ActivityRow, LeadListRow, NoteRow } from "@/server/repositories/lead-admin";

/**
 * Shapes sent to the admin lead screens (S5.1 to S5.3), as pure functions so they are tested without a database. The SLA
 * badge is read from the stored `sla_due_at` and `first_response_at` and never recalculated (FR-12, architecture 10.7).
 */

export interface SlaView {
  status: SlaStatus;
  /** The stored target, ISO UTC. The screen shows it in WAT. */
  dueAt: string;
}

export function slaView(row: { slaDueAt: Date; firstResponseAt: Date | null }, now: Date): SlaView {
  return { status: slaStatus(row, now), dueAt: row.slaDueAt.toISOString() };
}

export interface StaffPerson {
  userId: string;
  email: string;
  name: string;
}

/** What a screen shows for a person: the name when there is one, else the email. Null when the person is no longer staff. */
export function personLabel(id: string | null, people: ReadonlyMap<string, StaffPerson>): { id: string; label: string } | null {
  if (!id) return null;
  const person = people.get(id);
  return { id, label: person ? person.name.trim() || person.email : "" };
}

export interface LeadListItem {
  id: string;
  ref: string;
  /** Null once the lead is erased. */
  name: string | null;
  country: string;
  stage: string;
  assigned: { id: string; /** Empty when the person is no longer on the team. */ label: string } | null;
  sla: SlaView;
  receivedAt: string;
  erased: boolean;
  quick: boolean;
}

export function leadListItem(row: LeadListRow, people: ReadonlyMap<string, StaffPerson>, now: Date): LeadListItem {
  return {
    id: row.id,
    ref: row.ref,
    name: row.name,
    country: row.countryCode,
    stage: row.stageCode,
    assigned: personLabel(row.assignedAdminId, people),
    sla: slaView(row, now),
    receivedAt: row.receivedAt.toISOString(),
    erased: row.anonymisedAt !== null,
    quick: row.intakeKind === "quick",
  };
}

/** The activity types a timeline can show, and the only keys of their `data` a screen is given (ids and codes, never text). */
const SAFE_DATA_KEYS: Readonly<Record<string, readonly string[]>> = {
  created: [],
  note: ["note_id"],
  stage_changed: ["from", "to"],
  reply_logged: ["first"],
  assigned: ["from", "to", "reason"],
  admin_wa_opened: [],
  claimed: ["method", "verification_method"],
  merged: ["kept", "merged"],
  duplicate_dismissed: ["other"],
  anonymised: [],
};

export interface TimelineItem {
  id: string;
  type: string;
  at: string;
  /** The person who did it; null for the system. */
  by: { id: string; label: string } | null;
  data: Record<string, unknown>;
  /** For a `note` entry: the text, or null once erased. */
  note?: { body: string | null; erased: boolean };
}

/** Newest first, as the rows arrive. A note's text is joined in here, because the activity holds only its id (ADR-007). */
export function timeline(activities: readonly ActivityRow[], notes: readonly NoteRow[], people: ReadonlyMap<string, StaffPerson>): TimelineItem[] {
  const noteById = new Map(notes.map((n) => [n.id, n]));
  return activities.map((a) => {
    const keys = SAFE_DATA_KEYS[a.type] ?? [];
    const data = Object.fromEntries(Object.entries(a.data).filter(([key]) => keys.includes(key)));
    const item: TimelineItem = { id: a.id, type: a.type, at: a.createdAt.toISOString(), by: personLabel(a.actorId, people), data };
    if (a.type === "note") {
      const note = typeof a.data.note_id === "string" ? noteById.get(a.data.note_id) : undefined;
      item.note = note ? { body: note.erased ? null : note.body, erased: note.erased } : { body: null, erased: true };
    }
    return item;
  });
}

/** Today in WAT as two UTC instants, for the Overview's "Today's leads". */
export function watDayBounds(now: Date): { start: Date; end: Date } {
  const start = startOfWatDay(now);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}
