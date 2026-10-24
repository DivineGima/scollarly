import type { EVENT_TYPES } from "@/lib/constants";
import { offlineDb, type QueuedEvent } from "./db";
import { isEventExpired } from "./logic";

/**
 * The browser side of analytics (S4.5, architecture 10.2, 10.3). An event is written to the local queue first and sent in
 * batches of up to 50 to `POST /api/v1/events` on the next flush (page hidden, back online, app load). Nothing identifies a
 * person: the session id is random and kept only in the browser, and the only identifier an event may carry is a lead
 * reference on a `wa_tap`. Events older than 7 days are dropped.
 */

export const EVENTS_ENDPOINT = "/api/v1/events";
export const EVENT_BATCH_SIZE = 50;
/** A browsing session ends after this much inactivity and the next event starts a new random id. */
const SESSION_IDLE_MS = 30 * 60_000;

export type EventType = (typeof EVENT_TYPES)[number];

export interface TrackedEvent {
  type: EventType;
  leadRef?: string;
  universityId?: string;
  pageGroup?: string;
}

interface SessionRecord {
  id: string;
  lastSeen: number;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The random session id (architecture 11.2 `meta`). A new one starts after 30 minutes without an event. */
export async function currentSessionId(now = Date.now()): Promise<string> {
  const db = await offlineDb();
  const stored = (await db.get("meta", "session")) as SessionRecord | undefined;
  const continuing = Boolean(stored && now - stored.lastSeen < SESSION_IDLE_MS);
  const record: SessionRecord = continuing && stored ? { id: stored.id, lastSeen: now } : { id: randomId(), lastSeen: now };
  await db.put("meta", record, "session");
  // A new browsing session is a visit. The install prompt waits for a repeat visit (architecture 16 A1 step 6).
  if (!continuing) await db.put("meta", (((await db.get("meta", "visits")) as number | undefined) ?? 0) + 1, "visits");
  return record.id;
}

/** Writes an event to the local queue. Never throws: a browser without IndexedDB simply records nothing. */
export async function trackEvent(event: TrackedEvent, now = Date.now()): Promise<void> {
  try {
    const sessionId = await currentSessionId(now);
    const db = await offlineDb();
    const row: QueuedEvent = { type: event.type, sessionId, occurredAt: new Date(now).toISOString(), createdAt: now };
    if (event.leadRef) row.leadRef = event.leadRef;
    if (event.universityId) row.universityId = event.universityId;
    if (event.pageGroup) row.pageGroup = event.pageGroup;
    await db.add("eventQueue", row);
  } catch {
    // No queue, no event. Analytics must never break a page.
  }
}

/** The wire form of a queued event (`events` in the request body of architecture 8.2). */
export function toWireEvent(event: QueuedEvent): Record<string, string> {
  const wire: Record<string, string> = { type: event.type, occurred_at: event.occurredAt };
  if (event.sessionId) wire.session_id = event.sessionId;
  if (event.leadRef) wire.lead_ref = event.leadRef;
  if (event.universityId) wire.university_id = event.universityId;
  if (event.pageGroup) wire.page_group = event.pageGroup;
  return wire;
}

/** Sends the queued events in batches and deletes what the server accepted. Stops at the first failure and keeps the rest. */
export async function flushEvents(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const db = await offlineDb();
    for (const row of await db.getAll("eventQueue")) {
      if (row.id !== undefined && isEventExpired(row.createdAt, now)) await db.delete("eventQueue", row.id);
    }
    for (;;) {
      const batch = (await db.getAll("eventQueue", undefined, EVENT_BATCH_SIZE)).filter((row) => row.id !== undefined);
      if (batch.length === 0) break;
      const response = await fetchImpl(EVENTS_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch.map(toWireEvent) }),
      });
      // 202 is accepted. A 400 means the server will never take these rows, so they are dropped rather than retried forever.
      if (response.status !== 202 && response.status !== 400) break;
      const tx = db.transaction("eventQueue", "readwrite");
      await Promise.all(batch.map((row) => tx.store.delete(row.id as number)));
      await tx.done;
      if (response.status === 202) sent += batch.length;
    }
  } catch {
    // Offline or no queue: the events stay for the next flush.
  }
  return { sent };
}

/** Events are sent when this many are waiting, or the oldest has waited this long, so a few page views share one request. */
export const FLUSH_COUNT = 5;
export const FLUSH_AGE_MS = 5 * 60_000;

/** Sends the queue only when it is worth a request (architecture 12: batch events, spare the request quota). */
export async function flushIfDue(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<{ sent: number }> {
  try {
    const rows = await (await offlineDb()).getAll("eventQueue");
    const oldest = rows.reduce((min, row) => Math.min(min, row.createdAt), Number.POSITIVE_INFINITY);
    if (rows.length >= FLUSH_COUNT || (rows.length > 0 && now - oldest >= FLUSH_AGE_MS)) return await flushEvents(fetchImpl, now);
  } catch {
    // No queue: nothing to send.
  }
  return { sent: 0 };
}

/** How many browsing sessions this browser has started. */
export async function visitCount(): Promise<number> {
  try {
    return (((await (await offlineDb()).get("meta", "visits")) as number | undefined) ?? 0);
  } catch {
    return 0;
  }
}
