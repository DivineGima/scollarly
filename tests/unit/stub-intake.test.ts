import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";
import type { StubLeadInsert } from "@/server/repositories/phase0-leads";

const insertStubLead = vi.hoisted(() => vi.fn<(db: unknown, row: Record<string, string>) => Promise<StubLeadInsert>>());
vi.mock("@/server/repositories/phase0-leads", () => ({ insertStubLead }));

import { createStubLead, type StubLeadDeps } from "@/modules/leads/stub-intake";

const KEY = "0b0f6e5e-6a2e-4d54-9c9f-0f3a5f8d1a11";
const valid = { name: "Amina", whatsapp: "+237 651 232 301", country_code: "CM", turnstile_token: "tok" };

function deps(over: Partial<StubLeadDeps> = {}): StubLeadDeps {
  return {
    db: {} as Db,
    verifyTurnstile: vi.fn(async () => "ok" as const),
    limit: vi.fn(async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 0 })),
    newId: () => "11111111-1111-4111-8111-111111111111",
    ...over,
  };
}

beforeEach(() => {
  insertStubLead.mockReset();
  insertStubLead.mockResolvedValue({ kind: "created", id: "11111111-1111-4111-8111-111111111111" });
});

describe("createStubLead: validation (400)", () => {
  it("requires an Idempotency-Key that is a UUID", async () => {
    for (const idempotencyKey of [null, "", "not-a-uuid"]) {
      const out = await createStubLead(deps(), { idempotencyKey, body: valid });
      expect(out).toMatchObject({ ok: false, status: 400, code: "VALIDATION" });
    }
    expect(insertStubLead).not.toHaveBeenCalled();
  });

  it("rejects unknown fields (the contract is strict)", async () => {
    const out = await createStubLead(deps(), { idempotencyKey: KEY, body: { ...valid, role: "owner" } });
    expect(out).toMatchObject({ ok: false, status: 400 });
  });

  it("reports which fields are wrong", async () => {
    const out = await createStubLead(deps(), { idempotencyKey: KEY, body: { ...valid, name: "   ", whatsapp: "abc", country_code: "FR" } });
    expect(out.ok).toBe(false);
    if (!out.ok && out.status === 400) expect(Object.keys(out.fields).sort()).toEqual(["country_code", "name", "whatsapp"]);
  });

  it("rejects non-object bodies and oversized strings", async () => {
    for (const body of [null, "x", 5, [], { ...valid, name: "n".repeat(101) }, { ...valid, turnstile_token: "t".repeat(2049) }]) {
      expect(await createStubLead(deps(), { idempotencyKey: KEY, body })).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("does not spend a rate-limit hit or a Turnstile call on an invalid request", async () => {
    const d = deps();
    await createStubLead(d, { idempotencyKey: KEY, body: {} });
    expect(d.limit).not.toHaveBeenCalled();
    expect(d.verifyTurnstile).not.toHaveBeenCalled();
  });
});

describe("createStubLead: abuse controls", () => {
  it("returns 429 with Retry-After seconds when the limiter refuses, before Turnstile or the database", async () => {
    const d = deps({ limit: vi.fn(async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 42 })) });
    const out = await createStubLead(d, { idempotencyKey: KEY, body: valid });
    expect(out).toMatchObject({ ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 42 });
    expect(d.verifyTurnstile).not.toHaveBeenCalled();
    expect(insertStubLead).not.toHaveBeenCalled();
  });

  it("returns 403 TURNSTILE_FAILED and stores nothing when the token is rejected", async () => {
    const out = await createStubLead(deps({ verifyTurnstile: async () => "failed" }), { idempotencyKey: KEY, body: valid });
    expect(out).toMatchObject({ ok: false, status: 403, code: "TURNSTILE_FAILED" });
    expect(insertStubLead).not.toHaveBeenCalled();
  });

  it("returns 503 (client retries) when Turnstile itself is unreachable", async () => {
    const out = await createStubLead(deps({ verifyTurnstile: async () => "unavailable" }), { idempotencyKey: KEY, body: valid });
    expect(out).toMatchObject({ ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE" });
    expect(insertStubLead).not.toHaveBeenCalled();
  });
});

describe("createStubLead: persistence and idempotency", () => {
  it("returns 201 for a new lead", async () => {
    expect(await createStubLead(deps(), { idempotencyKey: KEY, body: valid })).toMatchObject({ ok: true, status: 201, replayed: false });
  });

  it("returns 200 replayed for the same key and payload", async () => {
    insertStubLead.mockResolvedValue({ kind: "replayed", id: "11111111-1111-4111-8111-111111111111" });
    expect(await createStubLead(deps(), { idempotencyKey: KEY, body: valid })).toMatchObject({ ok: true, status: 200, replayed: true });
  });

  it("returns 409 IDEMPOTENCY_KEY_REUSED for the same key with a different payload", async () => {
    insertStubLead.mockResolvedValue({ kind: "key_reused" });
    expect(await createStubLead(deps(), { idempotencyKey: KEY, body: valid })).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("returns 503 when the database is asleep or failing", async () => {
    insertStubLead.mockRejectedValue(new Error("connection terminated"));
    expect(await createStubLead(deps(), { idempotencyKey: KEY, body: valid })).toMatchObject({ ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE" });
  });

  it("hashes the payload without the single-use Turnstile token and in key-order-independent form", async () => {
    await createStubLead(deps(), { idempotencyKey: KEY, body: valid });
    await createStubLead(deps(), { idempotencyKey: KEY, body: { turnstile_token: "different-token", country_code: "CM", whatsapp: valid.whatsapp, name: valid.name } });
    const [first, second] = insertStubLead.mock.calls.map((c) => c[1]);
    expect(first?.payloadHash).toBe(second?.payloadHash);
  });

  it("changes the payload hash when a real field changes", async () => {
    await createStubLead(deps(), { idempotencyKey: KEY, body: valid });
    await createStubLead(deps(), { idempotencyKey: KEY, body: { ...valid, name: "Someone else" } });
    const [first, second] = insertStubLead.mock.calls.map((c) => c[1]);
    expect(first?.payloadHash).not.toBe(second?.payloadHash);
  });

  it("stores a trimmed name and a digits-only number", async () => {
    await createStubLead(deps(), { idempotencyKey: KEY, body: { ...valid, name: "  Amina  " } });
    expect(insertStubLead.mock.calls[0]?.[1]).toMatchObject({ name: "Amina", whatsappE164: "+237651232301", countryCode: "CM" });
  });
});
