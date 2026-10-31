import { backoffDelay, isDue, type QueuedLead } from "./logic";
import type { SendResult } from "./send";

/**
 * The sync engine (S4.2, architecture 11.2, 11.3). It sends the leads that are waiting and allowed, one at a time, and
 * decides what happens to each from the server's answer. It runs only while the app is open and online (no background
 * sync is relied on) and is started by: the `online` event, app load, opening `/apply`, and the tab becoming visible.
 * Two tabs never send at once (a Web Lock), and the idempotency key makes a double send harmless anyway.
 */

export interface SyncDeps {
  list: () => Promise<QueuedLead[]>;
  update: (key: string, patch: Partial<QueuedLead>) => Promise<void>;
  remove: (key: string) => Promise<void>;
  /** A fresh Turnstile token. Rejects when none can be had; the lead then waits for a later attempt. */
  getToken: () => Promise<string>;
  send: (item: QueuedLead, token: string) => Promise<SendResult>;
  now: () => number;
  /** Runs `task` only if no other tab is syncing; resolves with `undefined` when another tab holds the lock. */
  withLock: <T>(task: () => Promise<T>) => Promise<T | undefined>;
  /** Called for each lead the server stored, so the page can show "Sent". */
  onSent?: (item: QueuedLead, result: Extract<SendResult, { verdict: "sent" }>) => void;
}

export interface SyncReport {
  attempted: number;
  sent: number;
  rejected: number;
  waiting: number;
}

/** Applies one send result to the queue. Shared with the Continue button, so both paths treat an answer the same way. */
export async function applyResult(
  deps: Pick<SyncDeps, "update" | "remove" | "now" | "onSent">,
  item: QueuedLead,
  result: SendResult,
): Promise<"sent" | "rejected" | "waiting"> {
  const now = deps.now();
  switch (result.verdict) {
    case "sent":
      await deps.remove(item.key);
      deps.onSent?.(item, result);
      return "sent";
    case "rejected":
      // The server will never accept this payload. Keep it so the student can see why and remove it, but never retry it.
      await deps.update(item.key, { status: "failed", lastError: result.code, updatedAt: now });
      return "rejected";
    case "limited":
      await deps.update(item.key, {
        status: "pending",
        lastError: result.reason === "number_limit" ? "NUMBER_LIMIT" : "RATE_LIMITED",
        nextAttemptAt: now + Math.max(result.retryAfterSeconds * 1000, backoffDelay(item.attempts)),
        updatedAt: now,
      });
      return "waiting";
    case "retry":
      await deps.update(item.key, {
        status: "pending",
        lastError: result.code,
        nextAttemptAt: now + Math.max((result.retryAfterSeconds ?? 0) * 1000, backoffDelay(item.attempts)),
        updatedAt: now,
      });
      return "waiting";
  }
}

export async function syncOnce(deps: SyncDeps): Promise<SyncReport | undefined> {
  return deps.withLock(async () => {
    const report: SyncReport = { attempted: 0, sent: 0, rejected: 0, waiting: 0 };
    const due = (await deps.list()).filter((item) => isDue(item, deps.now())).sort((a, b) => a.createdAt - b.createdAt);

    for (const item of due) {
      const attempts = item.attempts + 1;
      await deps.update(item.key, { status: "sending", attempts, updatedAt: deps.now() });
      report.attempted += 1;
      let result: SendResult;
      try {
        // An onboarding item is sent by a signed-in person, so it needs no Turnstile token (the session protects it).
        const token = item.kind === "onboarding" ? "" : await deps.getToken();
        result = await deps.send({ ...item, attempts, status: "sending" }, token);
      } catch {
        // No token (Turnstile blocked or timed out) or an unexpected failure: wait and try again later.
        result = { verdict: "retry", status: 0, code: "TURNSTILE_UNAVAILABLE", retryAfterSeconds: null };
      }
      const outcome = await applyResult(deps, { ...item, attempts }, result);
      report[outcome] += 1;
    }
    return report;
  });
}

/** `navigator.locks` where it exists; otherwise the task just runs (the idempotency key is the safety net). */
export function browserLock(name = "scollarly-lead-sync"): SyncDeps["withLock"] {
  return async (task) => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return task();
    return locks.request(name, { ifAvailable: true }, async (lock) => (lock ? task() : undefined));
  };
}
