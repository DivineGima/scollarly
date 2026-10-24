import { describe, expect, it, vi } from "vitest";
import {
  backoffDelay,
  BACKOFF_MS,
  classifyLeadResponse,
  displayState,
  EVENT_EXPIRY_MS,
  isDue,
  isEventExpired,
  isLeadExpired,
  LEAD_EXPIRY_MS,
  nextDueIn,
  SEND_WAIT_MS,
  SENDING_STALE_MS,
  type QueuedLead,
} from "@/offline/logic";
import type { SendResult } from "@/offline/send";
import { sendLead } from "@/offline/send";
import { syncOnce, type SyncDeps } from "@/offline/sync-engine";
import { submitLead, type SubmitDeps } from "@/offline/submit";

/**
 * S4.2 and S4.3: the rules of the offline queue and the send-first flow, run with in-memory fakes (no browser). The real
 * IndexedDB, Web Locks and Turnstile are exercised by the Playwright tests (tests/e2e/stage4-leads.spec.ts).
 */

const T0 = 1_800_000_000_000;
const lead = (over: Partial<QueuedLead> = {}): QueuedLead => ({
  key: "11111111-1111-4111-8111-111111111111",
  payload: { client_ref: "SC-ABCDE-FGHJK", name: "Test" },
  ref: "SC-ABCDE-FGHJK",
  createdAt: T0,
  attempts: 0,
  lastError: null,
  status: "pending",
  nextAttemptAt: T0,
  updatedAt: T0,
  ...over,
});

describe("queue rules (architecture 11.2)", () => {
  it("backs off 5 s, 30 s, 2 min, 10 min, then an hour, and stays at an hour", () => {
    expect(BACKOFF_MS).toEqual([5_000, 30_000, 120_000, 600_000, 3_600_000]);
    expect([1, 2, 3, 4, 5, 6, 50].map(backoffDelay)).toEqual([5_000, 30_000, 120_000, 600_000, 3_600_000, 3_600_000, 3_600_000]);
    expect(backoffDelay(0)).toBe(5_000);
  });

  it("flags a lead older than 30 days, and drops events older than 7 days", () => {
    expect(LEAD_EXPIRY_MS).toBe(30 * 24 * 3_600_000);
    expect(isLeadExpired({ createdAt: T0 }, T0 + LEAD_EXPIRY_MS)).toBe(false);
    expect(isLeadExpired({ createdAt: T0 }, T0 + LEAD_EXPIRY_MS + 1)).toBe(true);
    expect(EVENT_EXPIRY_MS).toBe(7 * 24 * 3_600_000);
    expect(isEventExpired(T0, T0 + EVENT_EXPIRY_MS + 1)).toBe(true);
    expect(isEventExpired(T0, T0 + 1000)).toBe(false);
  });

  it("waits 4 seconds for the server before opening WhatsApp", () => expect(SEND_WAIT_MS).toBe(4000));

  it("reads each server answer: stored, never acceptable, wait, or try again", () => {
    expect([200, 201].map(classifyLeadResponse)).toEqual(["sent", "sent"]);
    expect([400, 409, 413].map(classifyLeadResponse)).toEqual(["rejected", "rejected", "rejected"]);
    expect(classifyLeadResponse(429)).toBe("limited");
    expect([403, 500, 502, 503, 504, 0, 302, 404].map(classifyLeadResponse)).toEqual(Array(8).fill("retry"));
  });

  it("is due when waiting and its time has come, not before, not when failed or expired, and an interrupted send is retried", () => {
    expect(isDue(lead(), T0)).toBe(true);
    expect(isDue(lead({ nextAttemptAt: T0 + 5000 }), T0)).toBe(false);
    expect(isDue(lead({ status: "failed" }), T0)).toBe(false);
    expect(isDue(lead({ status: "sent" }), T0)).toBe(false);
    expect(isDue(lead(), T0 + LEAD_EXPIRY_MS + 1)).toBe(false);
    expect(isDue(lead({ status: "sending", updatedAt: T0 }), T0 + 1000)).toBe(false);
    expect(isDue(lead({ status: "sending", updatedAt: T0 }), T0 + SENDING_STALE_MS + 1)).toBe(true);
  });

  it("reports when the next waiting lead is due", () => {
    expect(nextDueIn([], T0)).toBeNull();
    expect(nextDueIn([lead({ status: "failed" })], T0)).toBeNull();
    expect(nextDueIn([lead({ nextAttemptAt: T0 + 30_000 }), lead({ nextAttemptAt: T0 + 5_000 })], T0)).toBe(5_000);
    expect(nextDueIn([lead({ nextAttemptAt: T0 - 1_000 })], T0)).toBe(0);
  });

  it("names what the student sees for each state", () => {
    expect(displayState(lead(), T0)).toBe("saved");
    expect(displayState(lead({ status: "sending" }), T0)).toBe("sending");
    expect(displayState(lead({ status: "failed" }), T0)).toBe("rejected");
    expect(displayState(lead(), T0 + LEAD_EXPIRY_MS + 1)).toBe("not_sent");
  });
});

/** An in-memory queue that behaves like the IndexedDB store. */
function fakeStore(initial: QueuedLead[] = []) {
  const items = new Map(initial.map((i) => [i.key, i]));
  return {
    items,
    list: async () => [...items.values()],
    update: async (key: string, patch: Partial<QueuedLead>) => void (items.has(key) && items.set(key, { ...items.get(key)!, ...patch })),
    remove: async (key: string) => void items.delete(key),
    enqueue: async (item: QueuedLead) => void items.set(item.key, item),
  };
}

const sent: SendResult = { verdict: "sent", ref: "SC-ABCDE-FGHJK", replayed: false };

function syncDeps(store: ReturnType<typeof fakeStore>, send: SyncDeps["send"], now = () => T0, over: Partial<SyncDeps> = {}): SyncDeps {
  return { ...store, getToken: async () => "token", send, now, withLock: async (task) => task(), ...over };
}

describe("the sync engine (S4.2)", () => {
  it("sends a waiting lead and deletes it on success", async () => {
    const store = fakeStore([lead()]);
    const send = vi.fn(async () => sent);
    const onSent = vi.fn();
    const report = await syncOnce(syncDeps(store, send, () => T0, { onSent }));
    expect(report).toMatchObject({ attempted: 1, sent: 1 });
    expect(store.items.size).toBe(0);
    expect(send).toHaveBeenCalledOnce();
    expect(onSent).toHaveBeenCalledOnce();
  });

  it("sends the same idempotency key on every attempt", async () => {
    const store = fakeStore([lead()]);
    const keys: string[] = [];
    let now = T0;
    const fail = vi.fn(async (item: QueuedLead): Promise<SendResult> => (keys.push(item.key), { verdict: "retry", status: 503, code: "TEMPORARILY_UNAVAILABLE", retryAfterSeconds: null }));
    await syncOnce(syncDeps(store, fail, () => now));
    now += 6_000;
    await syncOnce(syncDeps(store, fail, () => now));
    expect(new Set(keys).size).toBe(1);
    expect(keys).toHaveLength(2);
  });

  it("keeps a failed lead, counts the attempt, and waits the backoff before the next try", async () => {
    const store = fakeStore([lead()]);
    const send = vi.fn(async (): Promise<SendResult> => ({ verdict: "retry", status: 503, code: "TEMPORARILY_UNAVAILABLE", retryAfterSeconds: null }));
    let now = T0;
    await syncOnce(syncDeps(store, send, () => now));
    const after = [...store.items.values()][0]!;
    expect(after).toMatchObject({ status: "pending", attempts: 1, lastError: "TEMPORARILY_UNAVAILABLE", nextAttemptAt: T0 + 5_000 });

    // Too early: not tried. After 5 s: tried again, and the next wait is 30 s.
    expect((await syncOnce(syncDeps(store, send, () => now + 1_000)))?.attempted).toBe(0);
    now += 5_000;
    await syncOnce(syncDeps(store, send, () => now));
    expect([...store.items.values()][0]).toMatchObject({ attempts: 2, nextAttemptAt: now + 30_000 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After when it is longer than the backoff", async () => {
    const store = fakeStore([lead()]);
    await syncOnce(syncDeps(store, async () => ({ verdict: "limited", retryAfterSeconds: 120, reason: "rate" })));
    expect([...store.items.values()][0]).toMatchObject({ status: "pending", lastError: "RATE_LIMITED", nextAttemptAt: T0 + 120_000 });
  });

  it("stops retrying a lead the server will never accept, and keeps it so the student can see why", async () => {
    const store = fakeStore([lead()]);
    const send = vi.fn(async (): Promise<SendResult> => ({ verdict: "rejected", status: 400, code: "VALIDATION", fields: { whatsapp: "PHONE_INVALID" } }));
    const report = await syncOnce(syncDeps(store, send));
    expect(report).toMatchObject({ rejected: 1 });
    expect([...store.items.values()][0]).toMatchObject({ status: "failed", lastError: "VALIDATION" });
    expect((await syncOnce(syncDeps(store, send, () => T0 + 10 * 3_600_000)))?.attempted).toBe(0);
  });

  it("treats a missing Turnstile token as a failed attempt to retry later, not as a lost lead", async () => {
    const store = fakeStore([lead()]);
    const report = await syncOnce(syncDeps(store, async () => sent, () => T0, { getToken: async () => Promise.reject(new Error("turnstile_unavailable")) }));
    expect(report).toMatchObject({ attempted: 1, waiting: 1, sent: 0 });
    expect([...store.items.values()][0]).toMatchObject({ status: "pending", lastError: "TURNSTILE_UNAVAILABLE" });
  });

  it("sends the oldest first, one at a time", async () => {
    const store = fakeStore([lead({ key: "b", ref: "B", createdAt: T0 + 10 }), lead({ key: "a", ref: "A", createdAt: T0 })]);
    const order: string[] = [];
    let active = 0;
    let overlapped = false;
    await syncOnce(
      syncDeps(store, async (item) => {
        active += 1;
        overlapped ||= active > 1;
        order.push(item.key);
        await Promise.resolve();
        active -= 1;
        return sent;
      }),
    );
    expect(order).toEqual(["a", "b"]);
    expect(overlapped).toBe(false);
  });

  it("does nothing when another tab holds the lock", async () => {
    const store = fakeStore([lead()]);
    const send = vi.fn(async () => sent);
    const report = await syncOnce(syncDeps(store, send, () => T0, { withLock: async () => undefined }));
    expect(report).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(store.items.size).toBe(1);
  });

  it("does not send a lead older than 30 days", async () => {
    const store = fakeStore([lead()]);
    const send = vi.fn(async () => sent);
    expect((await syncOnce(syncDeps(store, send, () => T0 + LEAD_EXPIRY_MS + 1)))?.attempted).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

function submitDeps(store: ReturnType<typeof fakeStore>, over: Partial<SubmitDeps> = {}): SubmitDeps {
  let n = 0;
  return {
    ...store,
    isOnline: () => true,
    getToken: async () => "token",
    send: async () => sent,
    now: () => T0,
    wait: () => new Promise(() => undefined), // never fires unless a test says so
    newKey: () => `key-${(n += 1)}`,
    ...over,
  };
}
const draft = { payload: { client_ref: "SC-ABCDE-FGHJK", intake_kind: "quick" } };

describe("Continue: send first, then hand off (ADR-031, S4.3)", () => {
  it("online and answered in time: the lead is stored and removed from the phone, WhatsApp may open with the server's reference", async () => {
    const store = fakeStore();
    const result = await submitLead(submitDeps(store, { send: async () => ({ verdict: "sent", ref: "SC-SERVE-RREF1", replayed: false }) }), draft);
    expect(result).toEqual({ kind: "sent", ref: "SC-SERVE-RREF1", key: "key-1" });
    expect(store.items.size).toBe(0);
  });

  it("saves to the phone before it sends anything", async () => {
    const store = fakeStore();
    let savedWhenSending = false;
    await submitLead(
      submitDeps(store, {
        send: async (item) => {
          savedWhenSending = store.items.has(item.key);
          return sent;
        },
      }),
      draft,
    );
    expect(savedWhenSending).toBe(true);
  });

  it("offline: nothing is sent, the lead stays saved, and WhatsApp opens anyway", async () => {
    const store = fakeStore();
    const send = vi.fn(async () => sent);
    const result = await submitLead(submitDeps(store, { isOnline: () => false, send }), draft);
    expect(result).toEqual({ kind: "queued", ref: "SC-ABCDE-FGHJK", key: "key-1", reason: "offline" });
    expect(send).not.toHaveBeenCalled();
    expect(store.items.get("key-1")).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("slow (over 4 s): WhatsApp opens at once, and the answer that arrives later still removes the lead, so there is one", async () => {
    const store = fakeStore();
    let answer: (r: SendResult) => void = () => undefined;
    const slow = new Promise<SendResult>((resolve) => (answer = resolve));
    const result = await submitLead(submitDeps(store, { send: () => slow, wait: async () => "timeout" }), draft);
    expect(result).toMatchObject({ kind: "queued", reason: "slow" });
    expect(store.items.has("key-1")).toBe(true);

    answer(sent);
    await vi.waitFor(() => expect(store.items.has("key-1")).toBe(false));
  });

  it("slow and never answered: the lead stays queued with its key for the sync engine, which sends it once", async () => {
    const store = fakeStore();
    const never = new Promise<SendResult>(() => undefined);
    await submitLead(submitDeps(store, { send: () => never, wait: async () => "timeout" }), draft);
    const sends: string[] = [];
    // Pretend the page was reopened later: the interrupted `sending` lead is picked up after a minute.
    await syncOnce(
      syncDeps(
        store,
        async (item) => {
          sends.push(item.key);
          return sent;
        },
        () => T0 + SENDING_STALE_MS + 1,
      ),
    );
    expect(sends).toEqual(["key-1"]);
    expect(store.items.size).toBe(0);
  });

  it("a failed attempt (server down, Turnstile blocked) keeps the lead and still opens WhatsApp", async () => {
    const store = fakeStore();
    const down = await submitLead(submitDeps(store, { send: async () => ({ verdict: "retry", status: 503, code: "TEMPORARILY_UNAVAILABLE", retryAfterSeconds: null }) }), draft);
    expect(down).toMatchObject({ kind: "queued", reason: "failed" });
    const noToken = await submitLead(submitDeps(fakeStore(), { getToken: async () => Promise.reject(new Error("blocked")) }), draft);
    expect(noToken).toMatchObject({ kind: "queued", reason: "failed" });
    expect(store.items.get("key-1")).toMatchObject({ status: "pending", lastError: "TEMPORARILY_UNAVAILABLE" });
  });

  it("a refusal of the details removes the lead (nothing to retry) and hands the fields to the form", async () => {
    const store = fakeStore();
    const result = await submitLead(submitDeps(store, { send: async () => ({ verdict: "rejected", status: 400, code: "VALIDATION", fields: { whatsapp: "PHONE_INVALID" } }) }), draft);
    expect(result).toEqual({ kind: "rejected", code: "VALIDATION", fields: { whatsapp: "PHONE_INVALID" } });
    expect(store.items.size).toBe(0);
  });

  it("too many attempts removes the lead and says why, without opening a send loop", async () => {
    const store = fakeStore();
    const result = await submitLead(submitDeps(store, { send: async () => ({ verdict: "limited", retryAfterSeconds: 3600, reason: "number_limit" }) }), draft);
    expect(result).toEqual({ kind: "limited", reason: "number_limit", retryAfterSeconds: 3600 });
    expect(store.items.size).toBe(0);
  });

  it("when the browser cannot save at all it says so instead of pretending", async () => {
    const result = await submitLead(submitDeps(fakeStore(), { enqueue: async () => Promise.reject(new Error("QuotaExceededError")) }), draft);
    expect(result).toEqual({ kind: "save_failed" });
  });

  it("gives each submission its own key, so two different leads are never confused", async () => {
    const store = fakeStore();
    const deps = submitDeps(store);
    const a = await submitLead(deps, draft);
    const b = await submitLead(deps, { payload: { client_ref: "SC-ZZZZZ-ZZZZZ" } });
    expect([a, b].map((r) => (r.kind === "sent" ? r.key : ""))).toEqual(["key-1", "key-2"]);
  });
});

describe("sendLead: one attempt over HTTP", () => {
  const item = { key: "11111111-1111-4111-8111-111111111111", payload: { name: "Test", client_ref: "SC-ABCDE-FGHJK" } };
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));

  it("posts the payload with the Turnstile token and the idempotency key, and reads a created lead", async () => {
    const fetchImpl = reply(201, { status: "created", ref: "SC-ABCDE-FGHJK" });
    const result = await sendLead(item, "tok", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ verdict: "sent", ref: "SC-ABCDE-FGHJK", replayed: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/leads");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(item.key);
    expect(JSON.parse(init.body as string)).toEqual({ ...item.payload, turnstile_token: "tok" });
  });

  it("reads a replay, a refusal with its fields, a limit with Retry-After, and a server error", async () => {
    expect(await sendLead(item, "t", reply(200, { status: "replayed", ref: "SC-ABCDE-FGHJK" }) as unknown as typeof fetch)).toMatchObject({ verdict: "sent", replayed: true });
    expect(await sendLead(item, "t", reply(400, { error: { code: "VALIDATION", fields: { name: "REQUIRED" } } }) as unknown as typeof fetch)).toEqual({ verdict: "rejected", status: 400, code: "VALIDATION", fields: { name: "REQUIRED" } });
    expect(await sendLead(item, "t", reply(429, { error: { code: "RATE_LIMITED" } }, { "Retry-After": "90" }) as unknown as typeof fetch)).toEqual({ verdict: "limited", retryAfterSeconds: 90, reason: "rate" });
    expect(await sendLead(item, "t", reply(429, { error: { code: "RATE_LIMITED", fields: { reason: "number_limit" } } }, { "Retry-After": "3600" }) as unknown as typeof fetch)).toMatchObject({ reason: "number_limit" });
    expect(await sendLead(item, "t", reply(403, { error: { code: "TURNSTILE_FAILED" } }) as unknown as typeof fetch)).toMatchObject({ verdict: "retry", status: 403 });
    expect(await sendLead(item, "t", reply(503, { error: { code: "TEMPORARILY_UNAVAILABLE" } }, { "Retry-After": "60" }) as unknown as typeof fetch)).toMatchObject({ verdict: "retry", retryAfterSeconds: 60 });
  });

  it("never throws: a lost connection, a page that is not JSON, and a success with no reference are all 'try again'", async () => {
    expect(await sendLead(item, "t", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch)).toMatchObject({ verdict: "retry", status: 0, code: "NETWORK" });
    expect(await sendLead(item, "t", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch)).toMatchObject({ verdict: "retry", status: 502 });
    expect(await sendLead(item, "t", reply(201, {}) as unknown as typeof fetch)).toMatchObject({ verdict: "retry", code: "BAD_RESPONSE" });
  });
});
