import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createStubLead, type StubLeadDeps } from "@/modules/leads/stub-intake";
import { countStubLeads } from "@/server/repositories/phase0-leads";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const valid = { name: "Amina", whatsapp: "+237 651 232 301", country_code: "CM", turnstile_token: "tok" };
const deps = (over: Partial<StubLeadDeps> = {}): StubLeadDeps => ({
  db: t.db,
  verifyTurnstile: vi.fn(async () => "ok" as const),
  limit: vi.fn(async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 0 })),
  newId: () => randomUUID(),
  ...over,
});

describe("stub lead intake against a real database (S0.3)", () => {
  it("creates a lead once and returns a replay for the same key and payload", async () => {
    const key = randomUUID();
    const first = await createStubLead(deps(), { idempotencyKey: key, body: valid });
    const again = await createStubLead(deps(), { idempotencyKey: key, body: { ...valid, turnstile_token: "a-fresh-token" } });
    expect(first).toMatchObject({ ok: true, status: 201, replayed: false });
    expect(again).toMatchObject({ ok: true, status: 200, replayed: true });
    expect(again.ok && first.ok && again.id).toBe(first.ok && first.id);
  });

  it("returns 409 when the same key arrives with a different payload", async () => {
    const key = randomUUID();
    await createStubLead(deps(), { idempotencyKey: key, body: valid });
    const clash = await createStubLead(deps(), { idempotencyKey: key, body: { ...valid, name: "Someone else" } });
    expect(clash).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("stores exactly one row when the same request is sent several times at once (double submit, two tabs)", async () => {
    const key = randomUUID();
    const before = await countStubLeads(t.db);
    const results = await Promise.all(Array.from({ length: 6 }, () => createStubLead(deps(), { idempotencyKey: key, body: valid })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.status === 201)).toHaveLength(1);
    expect(await countStubLeads(t.db)).toBe(before + 1);
  });

  it("stores nothing when validation, the rate limit or Turnstile refuse the request", async () => {
    const before = await countStubLeads(t.db);
    await createStubLead(deps(), { idempotencyKey: randomUUID(), body: { ...valid, country_code: "XX" } });
    await createStubLead(deps({ limit: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 30 }) }), { idempotencyKey: randomUUID(), body: valid });
    await createStubLead(deps({ verifyTurnstile: async () => "failed" }), { idempotencyKey: randomUUID(), body: valid });
    expect(await countStubLeads(t.db)).toBe(before);
  });

  it("persists a trimmed name, a digits-only number and the server received time", async () => {
    const key = randomUUID();
    await createStubLead(deps(), { idempotencyKey: key, body: { ...valid, name: "  Kofi  ", whatsapp: "+233 24 123 4567" } });
    const rows = (await t.run(`select name, whatsapp_e164, country_code, received_at from phase0_lead_stub where idempotency_key = '${key}'`)) as Array<{
      name: string;
      whatsapp_e164: string;
      country_code: string;
      received_at: Date | string;
    }>;
    expect(rows[0]).toMatchObject({ name: "Kofi", whatsapp_e164: "+233241234567", country_code: "CM" });
    expect(Math.abs(new Date(rows[0]!.received_at).getTime() - Date.now())).toBeLessThan(60_000);
  });
});
