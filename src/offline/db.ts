import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { QueuedLead } from "./logic";

/**
 * The browser's small database (architecture 11.2). Four stores:
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

export interface ProgressSnapshot {
  userId: string;
  leadRef: string;
  stageCode: string;
  updatedAt: number;
}

interface ScollarlyDb extends DBSchema {
  leadQueue: { key: string; value: QueuedLead };
  eventQueue: { key: number; value: QueuedEvent };
  meta: { key: string; value: unknown };
  progressSnapshot: { key: string; value: ProgressSnapshot };
}

export type OfflineDb = IDBPDatabase<ScollarlyDb>;

const NAME = "scollarly";
const VERSION = 1;

let opening: Promise<OfflineDb> | null = null;

/** Opens the database once per page. Rejects where IndexedDB is unavailable (some private windows); callers handle that. */
export function offlineDb(): Promise<OfflineDb> {
  opening ??= openDB<ScollarlyDb>(NAME, VERSION, {
    upgrade(db) {
      db.createObjectStore("leadQueue", { keyPath: "key" });
      db.createObjectStore("eventQueue", { keyPath: "id", autoIncrement: true });
      db.createObjectStore("meta");
      db.createObjectStore("progressSnapshot", { keyPath: "userId" });
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
