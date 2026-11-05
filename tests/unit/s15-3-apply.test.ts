import { describe, expect, it, vi } from "vitest";
import { applicationBodySchema } from "@/modules/applications/schema";
import { toResponse } from "@/modules/applications/endpoints";
import { MAX_PROGRAMMES, MIN_PROGRAMMES, orderProgrammes, type ProgrammeChoice } from "@/modules/applications/programmes";
import { applyFromProfile, type ApplyDeps } from "@/modules/applications/service";
import { toProgrammeChoices } from "@/modules/content/course-catalogue";
import type { CatalogueSnapshot } from "@/modules/content/types";
import type { ApplicationOutcome, NewApplication } from "@/server/repositories/applications";
import { sendLead } from "@/offline/send";
import { syncOnce, type SyncDeps } from "@/offline/sync-engine";
import type { QueuedLead } from "@/offline/logic";
import { isKeptShell } from "@/lib/sw-rules";
import { STATUS_BY_CODE } from "@/lib/http";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S15.3 (PRD_4 F24, FR-34; architecture 23.3): the body the phone sends, the server decision behind `POST /api/v1/me/application`, the
 * order of the programmes on the Apply screen, and the way an application travels through the offline queue. The database side is in
 * tests/integration/s15-3-apply.test.ts; the screen is driven by tests/e2e/s15-3-apply.spec.ts.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-11-04T10:00:00Z"); // a Wednesday

const body = (over: Record<string, unknown> = {}) => ({ programme_ids: [A, B, C], locale: "en", client_ref: "SC-ABCDE-FGHJK", client_created_at: "2026-11-04T09:59:00.000Z", ...over });

describe("the body the phone sends", () => {
  it("is the programmes in order, the language and the device's own bookkeeping, and nothing about the person", () => {
    const parsed = applicationBodySchema.safeParse(body());
    expect(parsed.success).toBe(true);
    expect(applicationBodySchema.safeParse(body({ name: "Someone" })).success).toBe(false);
    expect(applicationBodySchema.safeParse(body({ user_id: "x" })).success).toBe(false);
    expect(applicationBodySchema.safeParse(body({ whatsapp: "+2348031234567" })).success).toBe(false);
  });

  it("needs three different programmes, at most twenty, known by their ids", () => {
    expect(MIN_PROGRAMMES).toBe(3);
    expect(MAX_PROGRAMMES).toBe(20);
    const issue = (ids: unknown) => {
      const result = applicationBodySchema.safeParse(body({ programme_ids: ids }));
      return result.success ? null : result.error.issues.map((i) => i.message);
    };
    expect(issue([A, B])).toEqual(["PROGRAMMES_MIN_3"]);
    expect(issue([])).toEqual(["PROGRAMMES_MIN_3"]);
    expect(issue([A, A, B])).toEqual(["DUPLICATE"]);
    expect(issue(Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`))).toEqual(["TOO_LONG"]);
    expect(issue([A, B, "not-a-uuid"])).toEqual(["INVALID"]);
    expect(issue(undefined)?.length).toBeGreaterThan(0);
    expect(issue([A, B, C, D])).toBeNull();
  });

  it("refuses a malformed reference, an unknown language and a bad time", () => {
    expect(applicationBodySchema.safeParse(body({ client_ref: "nope" })).success).toBe(false);
    expect(applicationBodySchema.safeParse(body({ locale: "xx" })).success).toBe(false);
    expect(applicationBodySchema.safeParse(body({ client_created_at: "yesterday" })).success).toBe(false);
  });
});

describe("POST me/application: the server decision (23.3)", () => {
  function setup(outcome: ApplicationOutcome | Error) {
    const rows: NewApplication[] = [];
    const deps: ApplyDeps = {
      insert: vi.fn(async (row) => {
        rows.push(row);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }),
      slaSettings: async () => ({ weekdayHours: 4, weekendHours: 24 }),
      now: () => NOW,
      newId: () => "66666666-6666-4666-8666-666666666666",
      newRef: () => "SC-22222-33333",
      onError: vi.fn(),
    };
    return { deps, rows };
  }

  it("creates the application once, with the response clock set by the server clock and the programmes in order", async () => {
    const { deps, rows } = setup({ kind: "created", id: "id", ref: "SC-ABCDE-FGHJK", storedHash: "h" });
    const result = await applyFromProfile(deps, { idempotencyKey: KEY, body: body({ programme_ids: [C, A, B] }) });
    expect(result).toEqual({ ok: true, status: 201, ref: "SC-ABCDE-FGHJK", replayed: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idempotencyKey: KEY, clientRef: "SC-ABCDE-FGHJK", locale: "en", programmeIds: [C, A, B], slaHoursApplied: 4, numberLimit: 5 });
    expect(rows[0]?.slaDueAt.toISOString()).toBe("2026-11-04T14:00:00.000Z");
    expect(rows[0]?.refs[0]).toBe("SC-ABCDE-FGHJK");
    // Who is applying never travels in the call: the database reads it from the profile.
    expect(Object.keys(rows[0] as object)).not.toEqual(expect.arrayContaining(["name", "whatsappE164", "countryCode"]));
  });

  it("answers a replay with 200 and the same reference, and refuses the same key with different programmes", async () => {
    const first = setup({ kind: "created", id: "id", ref: "SC-ABCDE-FGHJK", storedHash: "h" });
    await applyFromProfile(first.deps, { idempotencyKey: KEY, body: body() });
    const hash = first.rows[0]?.payloadHash ?? "";
    const again = setup({ kind: "existing", id: "id", ref: "SC-ABCDE-FGHJK", storedHash: hash });
    expect(await applyFromProfile(again.deps, { idempotencyKey: KEY, body: body() })).toEqual({ ok: true, status: 200, ref: "SC-ABCDE-FGHJK", replayed: true });
    const different = setup({ kind: "existing", id: "id", ref: "SC-ABCDE-FGHJK", storedHash: "a-different-hash" });
    expect(await applyFromProfile(different.deps, { idempotencyKey: KEY, body: body() })).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("tells an account that already applied, with the reference of its application", async () => {
    const { deps } = setup({ kind: "already_applied", ref: "SC-OLDAP-PLIED" });
    const result = await applyFromProfile(deps, { idempotencyKey: KEY, body: body() });
    expect(result).toEqual({ ok: false, status: 409, code: "ALREADY_APPLIED", message: "You already applied.", ref: "SC-OLDAP-PLIED" });
  });

  it("sends a person with no profile to the questionnaire, and refuses an account that may not apply", async () => {
    expect(await applyFromProfile(setup({ kind: "profile_required" }).deps, { idempotencyKey: KEY, body: body() })).toMatchObject({ ok: false, status: 403, code: "ONBOARDING_REQUIRED" });
    expect(await applyFromProfile(setup({ kind: "not_allowed" }).deps, { idempotencyKey: KEY, body: body() })).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
  });

  it("limits five applications from one number a day, and asks the phone to wait", async () => {
    const result = await applyFromProfile(setup({ kind: "number_limited" }).deps, { idempotencyKey: KEY, body: body() });
    expect(result).toMatchObject({ ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 3600, fields: { reason: "number_limit" } });
    const response = toResponse(result, "req");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
  });

  it("names a programme that does not exist, and asks the phone to retry when no reference was free", async () => {
    expect(await applyFromProfile(setup({ kind: "unknown_programme" }).deps, { idempotencyKey: KEY, body: body() })).toMatchObject({ ok: false, status: 400, fields: { programme_ids: "UNKNOWN_VALUE" } });
    expect(await applyFromProfile(setup({ kind: "ref_exhausted" }).deps, { idempotencyKey: KEY, body: body() })).toMatchObject({ ok: false, status: 503 });
  });

  it("asks the phone to retry when the database fails, and logs the fault without leaking it", async () => {
    const { deps } = setup(new Error("connection refused: host=db.internal password=secret"));
    const result = await applyFromProfile(deps, { idempotencyKey: KEY, body: body() });
    expect(result).toEqual({ ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." });
    expect(deps.onError).toHaveBeenCalledOnce();
  });

  it("refuses a bad key or a bad body before touching the database", async () => {
    const { deps } = setup({ kind: "created", id: "id", ref: "SC-ABCDE-FGHJK", storedHash: "h" });
    expect(await applyFromProfile(deps, { idempotencyKey: null, body: body() })).toMatchObject({ ok: false, status: 400, fields: { "Idempotency-Key": "INVALID" } });
    expect(await applyFromProfile(deps, { idempotencyKey: KEY, body: body({ programme_ids: [A, B] }) })).toMatchObject({ ok: false, status: 400, fields: { programme_ids: "PROGRAMMES_MIN_3" } });
    expect(await applyFromProfile(deps, { idempotencyKey: KEY, body: "not an object" })).toMatchObject({ ok: false, status: 400 });
    expect(deps.insert).not.toHaveBeenCalled();
  });

  it("answers ALREADY_APPLIED with a 409 that carries the reference, and has a status for the new code", async () => {
    const response = toResponse({ ok: false, status: 409, code: "ALREADY_APPLIED", message: "You already applied.", ref: "SC-OLDAP-PLIED" }, "req");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "ALREADY_APPLIED", fields: { ref: "SC-OLDAP-PLIED" } } });
    expect(STATUS_BY_CODE.ALREADY_APPLIED).toBe(409);
  });
});

describe("the order of the programmes on the Apply screen", () => {
  const choice = (id: string, name: string, universityName: string, field: string | null, naacGrade: string | null): ProgrammeChoice => ({ id, name, universityName, field, level: null, naacGrade });
  const list = [
    choice("1", "B.Com", "Beta University", "commerce", "A"),
    choice("2", "MBA", "Alpha University", "business_management", "A+"),
    choice("3", "B.Tech Computer Science", "Alpha University", "computer_science_it", "A+"),
    choice("4", "BBA", "Alpha University", "business_management", "A+"),
    choice("5", "Law", "Zeta University", "law", null),
  ];

  it("puts the programmes in the chosen course fields first, then the best NAAC grade, then the names", () => {
    const ordered = orderProgrammes(list, ["commerce", "law"]);
    expect(ordered.map((p) => p.name)).toEqual(["B.Com", "Law", "B.Tech Computer Science", "BBA", "MBA"]);
    expect(ordered.filter((p) => p.suggested).map((p) => p.name)).toEqual(["B.Com", "Law"]);
  });

  it("orders by grade and name when no course was chosen, ignores an unknown field, and loses nothing", () => {
    const ordered = orderProgrammes(list, ["astrology"]);
    expect(ordered.map((p) => p.name)).toEqual(["B.Tech Computer Science", "BBA", "MBA", "B.Com", "Law"]);
    expect(ordered.some((p) => p.suggested)).toBe(false);
    expect(ordered).toHaveLength(list.length);
  });

  it("reads the choices from the public catalogue, one per published programme with its university", () => {
    const snapshot = {
      universities: [
        { name: "Alpha University", naacGrade: "A+", programmes: [{ id: "a1", name: "MBA", field: "business_management", level: "postgraduate", durationMonths: 24 }] },
        { name: "Gamma University", naacGrade: null, programmes: [] },
      ],
    } as unknown as CatalogueSnapshot;
    expect(toProgrammeChoices(snapshot)).toEqual([{ id: "a1", name: "MBA", universityName: "Alpha University", field: "business_management", level: "postgraduate", naacGrade: "A+" }]);
  });
});

describe("an application in the offline queue (23.3)", () => {
  const T0 = 1_800_000_000_000;
  const item = (over: Partial<QueuedLead> = {}): QueuedLead => ({
    kind: "application",
    key: KEY,
    payload: body(),
    ref: "SC-ABCDE-FGHJK",
    createdAt: T0,
    attempts: 0,
    lastError: null,
    status: "pending",
    nextAttemptAt: T0,
    updatedAt: T0,
    ...over,
  });

  function deps(items: QueuedLead[], send: SyncDeps["send"]) {
    const store = new Map(items.map((i) => [i.key, i]));
    const getToken = vi.fn(async () => "token");
    const sync: SyncDeps = {
      list: async () => [...store.values()],
      update: async (key, patch) => void store.set(key, { ...(store.get(key) as QueuedLead), ...patch }),
      remove: async (key) => void store.delete(key),
      getToken,
      send,
      now: () => T0,
      withLock: async (task) => task(),
    };
    return { sync, store, getToken };
  }

  it("is sent without asking Turnstile for a token, and removed once the server has it", async () => {
    const send = vi.fn(async (): Promise<Awaited<ReturnType<SyncDeps["send"]>>> => ({ verdict: "sent", ref: "SC-ABCDE-FGHJK", replayed: false }));
    const { sync, store, getToken } = deps([item()], send);
    expect(await syncOnce(sync)).toMatchObject({ attempted: 1, sent: 1 });
    expect(getToken).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "application" }), "");
    expect(store.size).toBe(0);
  });

  it("keeps the same key on every retry, and waits when the session has ended", async () => {
    const send = vi.fn(async (): Promise<Awaited<ReturnType<SyncDeps["send"]>>> => ({ verdict: "retry", status: 401, code: "UNAUTHENTICATED", retryAfterSeconds: null }));
    const { sync, store } = deps([item()], send);
    await syncOnce(sync);
    expect(store.get(KEY)).toMatchObject({ status: "pending", lastError: "UNAUTHENTICATED", attempts: 1 });
  });

  describe("sending", () => {
    it("posts to the application endpoint with the key in the header and no Turnstile token", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "created", ref: "SC-ABCDE-FGHJK" }), { status: 201 }));
      const result = await sendLead({ kind: "application", key: "k-1", payload: body() }, "", fetchMock as unknown as typeof fetch);
      expect(result).toEqual({ verdict: "sent", ref: "SC-ABCDE-FGHJK", replayed: false });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/v1/me/application");
      expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
      expect(JSON.parse(String(init.body))).toEqual(body());
    });

    it("counts ALREADY_APPLIED as done, with the reference of the application that exists (another device applied first)", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "ALREADY_APPLIED", message: "You already applied.", fields: { ref: "SC-OLDAP-PLIED" } }, request_id: "r" }), { status: 409 }));
      expect(await sendLead({ kind: "application", key: "k-2", payload: body() }, "", fetchMock as unknown as typeof fetch)).toEqual({ verdict: "sent", ref: "SC-OLDAP-PLIED", replayed: true, alreadyApplied: true });
    });

    it("still treats any other 409 as a reason to stop, and a reused key is not 'done'", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "IDEMPOTENCY_KEY_REUSED", message: "x" }, request_id: "r" }), { status: 409 }));
      expect(await sendLead({ kind: "application", key: "k-3", payload: body() }, "", fetchMock as unknown as typeof fetch)).toMatchObject({ verdict: "rejected", status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    });

    it("does not treat ALREADY_APPLIED as done for any other kind of item", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "ALREADY_APPLIED", message: "x", fields: { ref: "SC-OLDAP-PLIED" } }, request_id: "r" }), { status: 409 }));
      expect(await sendLead({ key: "k-4", payload: { name: "x" } }, "tok", fetchMock as unknown as typeof fetch)).toMatchObject({ verdict: "rejected", code: "ALREADY_APPLIED" });
    });

    it("waits when the session has ended, and sends a person who has not finished onboarding to wait too", async () => {
      const ended = vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "x" } }), { status: 401 }));
      expect(await sendLead({ kind: "application", key: "k-5", payload: body() }, "", ended as unknown as typeof fetch)).toMatchObject({ verdict: "retry", status: 401, code: "UNAUTHENTICATED" });
      const early = vi.fn(async () => new Response(JSON.stringify({ error: { code: "ONBOARDING_REQUIRED", message: "x" } }), { status: 403 }));
      expect(await sendLead({ kind: "application", key: "k-6", payload: body() }, "", early as unknown as typeof fetch)).toMatchObject({ verdict: "retry", status: 403, code: "ONBOARDING_REQUIRED" });
    });
  });
});

describe("the Apply shell and the words", () => {
  it("is a signed-in shell the service worker may keep for offline use", () => {
    expect(isKeptShell("/me/apply")).toBe(true);
    expect(isKeptShell("/en/me/apply/")).toBe(true);
    expect(isKeptShell("/api/v1/me/application")).toBe(false);
    expect(isKeptShell("/apply")).toBe(false);
  });

  const keys = (value: unknown, prefix = ""): string[] =>
    value !== null && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];

  it("has the same Apply strings in English and French, and a Home button", () => {
    expect(keys(fr.student.apply).sort()).toEqual(keys(en.student.apply).sort());
    expect(en.student.home.applyButton).toBeTruthy();
    expect(fr.student.home.applyButton).toBeTruthy();
  });

  it("keeps the placeholders the screen fills in, in both languages", () => {
    for (const messages of [en, fr]) {
      expect(messages.student.apply.intro).toContain("{min}");
      expect(messages.student.apply.count).toContain("{count}");
      expect(messages.student.apply.count).toContain("{min}");
      expect(messages.student.apply.minProgrammes).toContain("{min}");
      expect(messages.student.apply.tooMany).toContain("{max}");
      expect(messages.student.apply.ref).toContain("{ref}");
      expect(messages.student.apply.choice).toContain("{n}");
    }
  });
});
