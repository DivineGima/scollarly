/**
 * The rules of the offline lead queue as pure functions (architecture 11.2, owner decisions D5 and D6), so they are tested
 * without a browser. Nothing here touches IndexedDB, the network or the clock.
 */

/** Retry waits after the 1st, 2nd, ... failed attempt: 5 s, 30 s, 2 min, 10 min, then every hour (architecture 11.2). */
export const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000] as const;

/** A pending lead older than this is flagged "not sent"; the student can resend or delete it. */
export const LEAD_EXPIRY_MS = 30 * 24 * 3_600_000;

/** Queued events older than this are dropped. */
export const EVENT_EXPIRY_MS = 7 * 24 * 3_600_000;

/** How long Continue waits for the server before opening WhatsApp anyway (ADR-031). */
export const SEND_WAIT_MS = 4_000;

/** A lead left in `sending` longer than this was interrupted (the tab closed mid-request) and is tried again. */
export const SENDING_STALE_MS = 60_000;

export type QueuedLeadStatus = "pending" | "sending" | "sent" | "failed";

/** A lead in the browser's queue. `payload` is the request body without the Turnstile token, which is fresh on every attempt. */
export interface QueuedLead {
  /** The idempotency key (a UUID). It never changes, so every retry is the same request. */
  key: string;
  payload: Record<string, unknown>;
  /** The reference the student sees, `SC-XXXXX-XXXXX`. */
  ref: string;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  status: QueuedLeadStatus;
  /** Earliest time the sync engine may try again. */
  nextAttemptAt: number;
  /** When `status` last changed, to spot an interrupted `sending`. */
  updatedAt: number;
}

/** The wait before attempt number `attempts + 1`, after `attempts` failures (1 gives 5 s). */
export function backoffDelay(attempts: number): number {
  const index = Math.min(Math.max(Math.trunc(attempts), 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
}

export function isLeadExpired(item: Pick<QueuedLead, "createdAt">, now: number): boolean {
  return now - item.createdAt > LEAD_EXPIRY_MS;
}

export function isEventExpired(createdAt: number, now: number): boolean {
  return now - createdAt > EVENT_EXPIRY_MS;
}

/** What the server's answer means for a queued lead. */
export type LeadVerdict = "sent" | "rejected" | "limited" | "retry";

/**
 *  200, 201            stored (a replay is the same lead): remove from the queue
 *  400, 409, 413       the server will never accept this payload: stop, show the reason
 *  429                 too many attempts or numbers: wait, as the server says
 *  403, 5xx, no answer a Turnstile problem or a server problem: try again later with a fresh token
 */
export function classifyLeadResponse(status: number): LeadVerdict {
  if (status === 200 || status === 201) return "sent";
  if (status === 400 || status === 409 || status === 413) return "rejected";
  if (status === 429) return "limited";
  return "retry";
}

/** A lead that is waiting and allowed to be tried now. A `sending` lead is skipped unless it was interrupted. */
export function isDue(item: QueuedLead, now: number): boolean {
  if (item.status === "sent" || item.status === "failed") return false;
  if (isLeadExpired(item, now)) return false;
  if (item.status === "sending") return now - item.updatedAt > SENDING_STALE_MS;
  return item.nextAttemptAt <= now;
}

/** Milliseconds until the earliest waiting lead may be tried, or null when none is waiting. 0 means now. */
export function nextDueIn(items: readonly QueuedLead[], now: number): number | null {
  let soonest: number | null = null;
  for (const item of items) {
    if (item.status === "sent" || item.status === "failed" || isLeadExpired(item, now)) continue;
    const at = item.status === "sending" ? item.updatedAt + SENDING_STALE_MS : item.nextAttemptAt;
    const wait = Math.max(at - now, 0);
    if (soonest === null || wait < soonest) soonest = wait;
  }
  return soonest;
}

/** What the student sees for each queued lead. */
export type LeadDisplay = "saved" | "sending" | "sent" | "not_sent" | "rejected";

export function displayState(item: QueuedLead, now: number): LeadDisplay {
  if (item.status === "sent") return "sent";
  if (item.status === "failed") return "rejected";
  if (isLeadExpired(item, now)) return "not_sent";
  return item.status === "sending" ? "sending" : "saved";
}
