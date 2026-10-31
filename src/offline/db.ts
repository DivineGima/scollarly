import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { QueuedLead } from "./logic";
import type { OnboardingValues } from "@/modules/onboarding/payload";

/**
 * The browser's small database (architecture 11.2). Six stores (`onboardingDraft` is the unfinished questionnaire of S13.3, kept until it is
 * sent and deleted on sign-out; `dashboardSnapshot` is the staff Home's totals, S13.6, deleted on sign-out):
 *   leadQueue         applications waiting to be sent, keyed by their idempotency key
 *   eventQueue        analytics events waiting for the next batch
 *   meta              the browsing session id and a visit counter
 *   progressSnapshot  the last synced stage of the student portal (written by Stage 8; created here so the schema has one version)
 * `progressSnapshot` holds no name, number or email.
 */

export interface QueuedEvent {
  id?: number;
  type: string;
  sessionId: string | null;
  leadRef?: string;
  universityId?: string;
  pageGroup?: string;
  /** The device clock, advisory only. */
  occurredAt: string;
  createdAt: number;
}

/** The unfinished questionnaire of one signed-in person (architecture 21.6). Never sent anywhere until the last screen. */
export interface OnboardingDraft {
  userId: string;
  values: OnboardingValues;
  /** The screen the person was on, so they come back to it. */
  step: string;
  /** The idempotency key and the reference, made once when the draft starts so a retry or a second tap is the same request. */
  key: string;
  ref: string;
  updatedAt: number;
}

/** The staff Home's numbers kept for an offline moment (architecture 21.11). Counts only: no lead, name, number or reference. */
export interface DashboardSnapshot {
  userId: string;
  period: string;
  role: string;
  /** The tile numbers and the leads-per-day line exactly as the Home call answered them (`totals` and `series`), without the activity list. */
  totals: unknown;
  series: { label: string; value: number }[];
  updatedAt: number;
}

export interface ProgressSnapshot {
  userId: string;
  /** Empty when the student has no linked application yet (a snapshot can then hold only the profile fields below). */
  leadRef: string;
  stageCode: string;
  updatedAt: number;
  /** S13.4 (architecture 21.11): the first name only, never the full name, a number or an email. */
  firstName?: string | null;
  /** The course fields and study level the student chose, so Universities can be ordered without a connection. */
  courseFields?: string[];
  level?: string | null;
}

interface ScollarlyDb extends DBSchema {
  leadQueue: { key: string; value: QueuedLead };
  eventQueue: { key: number; value: QueuedEvent };
  meta: { key: string; value: unknown };
  progressSnapshot: { key: string; value: ProgressSnapshot };
  onboardingDraft: { key: string; value: OnboardingDraft };
  dashboardSnapshot: { key: string; value: DashboardSnapshot };
}

export type OfflineDb = IDBPDatabase<ScollarlyDb>;

const NAME = "scollarly";
const VERSION = 3;

let opening: Promise<OfflineDb> | null = null;

/** Opens the database once per page. Rejects where IndexedDB is unavailable (some private windows); callers handle that. */
export function offlineDb(): Promise<OfflineDb> {
  opening ??= openDB<ScollarlyDb>(NAME, VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("leadQueue", { keyPath: "key" });
        db.createObjectStore("eventQueue", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("meta");
        db.createObjectStore("progressSnapshot", { keyPath: "userId" });
      }
      // Version 2 (S13.3): the onboarding draft. Existing queues and snapshots are untouched.
      if (oldVersion < 2) db.createObjectStore("onboardingDraft", { keyPath: "userId" });
      // Version 3 (S13.6): the staff Home's totals for offline reading.
      if (oldVersion < 3) db.createObjectStore("dashboardSnapshot", { keyPath: "userId" });
    },
  }).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

/** Whether the browser can keep a queue at all. A form uses this to say "Couldn't save" instead of pretending. */
export async function canSaveOffline(): Promise<boolean> {
  try {
    await offlineDb();
    return true;
  } catch {
    return false;
  }
}
