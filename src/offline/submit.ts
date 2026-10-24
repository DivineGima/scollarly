import { applyResult, type SyncDeps } from "./sync-engine";
import { SEND_WAIT_MS, type QueuedLead } from "./logic";
import type { SendResult } from "./send";

/**
 * "Continue" on the apply form and on the quick WhatsApp form: send first, then hand off (ADR-031, architecture 10.1,
 * 16 A5 steps 4 to 6). The lead is saved in the browser first, so nothing is lost if the browser is suspended. Then:
 *
 *   online, answered within 4 s    -> `sent`: the lead is stored; the caller opens WhatsApp with the reference
 *   offline, slow (over 4 s), failed -> `queued`: the lead stays in the queue; the caller opens WhatsApp anyway
 *   the server refuses the details  -> `rejected`: nothing is queued; the caller shows the fields
 *   too many attempts or numbers    -> `limited`: nothing is queued; the caller shows a plain message
 *   the browser cannot save at all  -> `save_failed`: the caller shows "Couldn't save" with a copy button
 *
 * A slow attempt is not abandoned: if the server answers after the 4 seconds, the lead is removed from the queue then, and
 * if it never answers, the sync engine sends it later with the same key, so exactly one lead is stored either way.
 */

export type SubmitResult =
  | { kind: "sent"; ref: string; key: string }
  | { kind: "queued"; ref: string; key: string; reason: "offline" | "slow" | "failed" }
  | { kind: "rejected"; fields: Record<string, string>; code: string }
  | { kind: "limited"; reason: "number_limit" | "rate"; retryAfterSeconds: number }
  | { kind: "save_failed" };

export interface SubmitDeps extends Pick<SyncDeps, "update" | "remove" | "now" | "getToken" | "onSent"> {
  enqueue: (item: QueuedLead) => Promise<void>;
  isOnline: () => boolean;
  send: (item: QueuedLead, token: string) => Promise<SendResult>;
  /** Resolves with "timeout" after `ms`. Injected so tests control the clock. */
  wait: (ms: number) => Promise<"timeout">;
  newKey: () => string;
}

export interface LeadDraft {
  /** The request body without `Idempotency-Key` and `turnstile_token`. */
  payload: Record<string, unknown> & { client_ref: string };
}

export async function submitLead(deps: SubmitDeps, draft: LeadDraft): Promise<SubmitResult> {
  const now = deps.now();
  const item: QueuedLead = {
    key: deps.newKey(),
    payload: draft.payload,
    ref: draft.payload.client_ref,
    createdAt: now,
    attempts: 0,
    lastError: null,
    status: "pending",
    nextAttemptAt: now,
    updatedAt: now,
  };

  try {
    await deps.enqueue(item);
  } catch {
    return { kind: "save_failed" };
  }

  if (!deps.isOnline()) return { kind: "queued", ref: item.ref, key: item.key, reason: "offline" };

  const attempting: QueuedLead = { ...item, attempts: 1, status: "sending" };
  await deps.update(item.key, { attempts: 1, status: "sending", updatedAt: deps.now() }).catch(() => undefined);

  const attempt = (async (): Promise<SendResult> => {
    try {
      return await deps.send(attempting, await deps.getToken());
    } catch {
      return { verdict: "retry", status: 0, code: "TURNSTILE_UNAVAILABLE", retryAfterSeconds: null };
    }
  })();
  // Whatever the answer and whenever it arrives, the queue is brought up to date exactly once.
  const settled = attempt.then((result) => applyResult(deps, attempting, result).then(() => result));
  settled.catch(() => undefined);

  const first = await Promise.race([settled, deps.wait(SEND_WAIT_MS)]);
  if (first === "timeout") return { kind: "queued", ref: item.ref, key: item.key, reason: "slow" };

  switch (first.verdict) {
    case "sent":
      return { kind: "sent", ref: first.ref, key: item.key };
    case "rejected":
      // Nothing to retry: the student fixes the form, which makes a new lead with a new key.
      await deps.remove(item.key).catch(() => undefined);
      return { kind: "rejected", fields: first.fields, code: first.code };
    case "limited":
      await deps.remove(item.key).catch(() => undefined);
      return { kind: "limited", reason: first.reason, retryAfterSeconds: first.retryAfterSeconds };
    case "retry":
      return { kind: "queued", ref: item.ref, key: item.key, reason: "failed" };
  }
}

/** A timer that resolves with "timeout"; the default `wait` of the forms. */
export const realWait = (ms: number): Promise<"timeout"> => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
