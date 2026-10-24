import { offlineDb } from "./db";
import type { QueuedLead } from "./logic";

/** The lead queue store (architecture 11.2). A sent lead is deleted at once, so nothing personal stays on the phone longer than needed. */

/** Fired on `window` after every change to the queue, so the "waiting to send" notice follows a lead queued after the page loaded. */
export const QUEUE_CHANGED_EVENT = "scollarly:queue-changed";

function announceChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

export async function enqueueLead(item: QueuedLead): Promise<void> {
  const db = await offlineDb();
  await db.put("leadQueue", item);
  announceChange();
}

export async function listLeads(): Promise<QueuedLead[]> {
  const db = await offlineDb();
  return (await db.getAll("leadQueue")).sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateLead(key: string, patch: Partial<QueuedLead>): Promise<void> {
  const db = await offlineDb();
  const tx = db.transaction("leadQueue", "readwrite");
  const current = await tx.store.get(key);
  if (current) await tx.store.put({ ...current, ...patch, key: current.key });
  await tx.done;
  announceChange();
}

export async function removeLead(key: string): Promise<void> {
  const db = await offlineDb();
  await db.delete("leadQueue", key);
  announceChange();
}

/** "Remove from this phone" (architecture 16 A5 step 8): every unsent application at once. */
export async function removeAllLeads(): Promise<void> {
  const db = await offlineDb();
  await db.clear("leadQueue");
  announceChange();
}
