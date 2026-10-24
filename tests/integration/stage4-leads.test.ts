import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/uuid";
import { createLead, type CreateLeadDeps } from "@/modules/leads/service";
import { planEvents } from "@/modules/events/service";
import { insertLead } from "@/server/repositories/leads";
import { recordWaTaps, WA_TAP_DAILY_CAP } from "@/server/repositories/events";
import { createTestDb, type TestDb } from "./helpers/db";
import { insertRow, programmeRow, q, uni } from "./helpers/fixtures";

/**
 * S4.4 and S4.5 against a real database, as the non-owner runtime role (ADR-038): the lead function (idempotency, the
 * per-number limit, reference collisions, programme preferences, the `created` activity) and the tap function (cap per
 * reference per WAT day, late linking). The service under test is the real one with the real repository.
 */

let t: TestDb;
const ids: Record<string, string> = {};
const NOW = new Date("2026-10-21T12:00:00Z"); // a Wednesday

let counter = 0;
// Ten characters from the reference alphabet, unique per call.
function freshRef(): string {
  counter += 1;
  const raw = (counter.toString(32).toUpperCase().padStart(4, "0") + "ABCDEF").slice(0, 10).replace(/[ILOU]/g, "7");
  return `SC-${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function deps(over: Partial<CreateLeadDeps> = {}): CreateLeadDeps {
  return {
    insert: (row) => insertLead(t.db, row),
    verifyTurnstile: async () => "ok",
    limit: async () => ({ allowed: true, remaining: 9, retryAfterSeconds: 0 }),
    slaSettings: async () => ({ weekdayHours: 4, weekendHours: 24 }),
    now: () => NOW,
    newId: () => uuidv7(),
    newRef: freshRef,
    ...over,
  };
}

const quick = (over: Record<string, unknown> = {}) => ({
  intake_kind: "quick",
  name: "Ama Test",
  whatsapp: "612345678",
  country_code: "CM",
  source: { page: "/universities/alpha", university_id: ids.uni },
  locale: "en",
  client_ref: freshRef(),
  client_created_at: "2026-10-21T11:59:00Z",
  consent: { notice_version: "draft-1" },
  turnstile_token: "tok",
  ...over,
});

const full = (over: Record<string, unknown> = {}) => ({
  intake_kind: "full",
  name: "Kofi Full",
  whatsapp: "08031234567",
  country_code: "NG",
  qualification_type: "olevel_alevel",
  results: [{ subject: "Maths", grade: "A" }],
  programme_ids: [ids.p1, ids.p2, ids.p3],
  source: { page: "/apply" },
  locale: "en",
  client_ref: freshRef(),
  client_created_at: "2026-10-21T11:59:00Z",
  consent: { notice_version: "draft-1" },
  turnstile_token: "tok",
  ...over,
});

const count = async (sql: string) => Number(((await t.run(sql)) as { n: string | number }[])[0]?.n);

beforeAll(async () => {
  t = await createTestDb();
  ids.uni = await uni(t, { status: "published" });
  ids.p1 = await programmeRow(t, ids.uni, { name: "P1", status: "published" });
  ids.p2 = await programmeRow(t, ids.uni, { name: "P2", status: "published" });
  ids.p3 = await programmeRow(t, ids.uni, { name: "P3", status: "published" });
  await t.asRuntime();
});

afterAll(async () => {
  await t.asOwner();
  await t.close();
});

describe("S4.4: the lead is stored once, with everything the rules need", () => {
  it("stores a full lead with its programmes in rank order, the SLA from the server clock, and a `created` activity", async () => {
    const key = crypto.randomUUID();
    const body = full({ programme_ids: [ids.p3, ids.p1, ids.p2] });
    const outcome = await createLead(deps(), { idempotencyKey: key, body });
    expect(outcome).toMatchObject({ ok: true, status: 201, replayed: false });
    await t.asOwner();
    try {
      const [row] = (await t.run(`select * from lead where idempotency_key = ${q(key)}`)) as Record<string, unknown>[];
      expect(row).toMatchObject({ intake_kind: "full", whatsapp_e164: "+2348031234567", country_code: "NG", stage_code: "share_results", sla_hours_applied: 4, qualification_type: "olevel_alevel" });
      expect(new Date(row!.received_at as string).toISOString()).toBe(NOW.toISOString());
      expect(new Date(row!.sla_due_at as string).toISOString()).toBe("2026-10-21T16:00:00.000Z");
      const prefs = (await t.run(`select programme_id, rank from lead_programme_pref where lead_id = ${q(row!.id)} order by rank`)) as { programme_id: string; rank: number }[];
      expect(prefs.map((p) => p.programme_id)).toEqual([ids.p3, ids.p1, ids.p2]);
      expect(prefs.map((p) => Number(p.rank))).toEqual([1, 2, 3]);
      const activity = (await t.run(`select type, actor_id, data from lead_activity where lead_id = ${q(row!.id)}`)) as { type: string; actor_id: string | null; data: Record<string, unknown> }[];
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({ type: "created", actor_id: null });
      // Ids and codes only, never free text (ADR-007).
      expect(JSON.stringify(activity[0]?.data)).not.toContain("Kofi");
    } finally {
      await t.asRuntime();
    }
  });

  it("stores a quick lead with no qualification, no results and the page's university in its source", async () => {
    const key = crypto.randomUUID();
    expect(await createLead(deps(), { idempotencyKey: key, body: quick() })).toMatchObject({ ok: true, status: 201 });
    await t.asOwner();
    try {
      const [row] = (await t.run(`select intake_kind, qualification_type, results, source from lead where idempotency_key = ${q(key)}`)) as Record<string, unknown>[];
      expect(row).toMatchObject({ intake_kind: "quick", qualification_type: null, results: [] });
      expect((row!.source as Record<string, unknown>).university_id).toBe(ids.uni);
    } finally {
      await t.asRuntime();
    }
  });

  it("the same key and payload again returns the same reference and stores nothing new; the same key with another payload is a conflict", async () => {
    const key = crypto.randomUUID();
    const body = quick({ whatsapp: "611111111" });
    const first = await createLead(deps(), { idempotencyKey: key, body });
    const again = await createLead(deps(), { idempotencyKey: key, body: { ...body, turnstile_token: "another-token" } });
    expect(first).toMatchObject({ ok: true, status: 201 });
    expect(again).toMatchObject({ ok: true, status: 200, replayed: true });
    if (first.ok && again.ok) expect(again.ref).toBe(first.ref);
    expect(await createLead(deps(), { idempotencyKey: key, body: { ...body, name: "Not The Same Person" } })).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    await t.asOwner();
    try {
      expect(await count(`select count(*) as n from lead where idempotency_key = ${q(key)}`)).toBe(1);
    } finally {
      await t.asRuntime();
    }
  });

  it("several identical requests at once (a double tap, two tabs, forced retries) store exactly one lead", async () => {
    const key = crypto.randomUUID();
    const body = quick({ whatsapp: "622222222" });
    const results = await Promise.all(Array.from({ length: 5 }, () => createLead(deps(), { idempotencyKey: key, body })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r.ok ? r.ref : ""))).size).toBe(1);
    await t.asOwner();
    try {
      expect(await count(`select count(*) as n from lead where idempotency_key = ${q(key)}`)).toBe(1);
      expect(await count(`select count(*) as n from lead_activity a join lead l on l.id = a.lead_id where l.idempotency_key = ${q(key)}`)).toBe(1);
    } finally {
      await t.asRuntime();
    }
  });

  it("a reference collision with another lead keeps the device value in client_ref and gives the lead a new server reference", async () => {
    const clash = freshRef();
    const a = await createLead(deps(), { idempotencyKey: crypto.randomUUID(), body: quick({ client_ref: clash, whatsapp: "633333331" }) });
    const key = crypto.randomUUID();
    const b = await createLead(deps(), { idempotencyKey: key, body: quick({ client_ref: clash, whatsapp: "633333332" }) });
    expect(a).toMatchObject({ ok: true, ref: clash });
    expect(b).toMatchObject({ ok: true, status: 201 });
    if (b.ok) expect(b.ref).not.toBe(clash);
    await t.asOwner();
    try {
      const [row] = (await t.run(`select ref, client_ref from lead where idempotency_key = ${q(key)}`)) as { ref: string; client_ref: string }[];
      expect(row?.client_ref).toBe(clash);
      expect(row?.ref).not.toBe(clash);
    } finally {
      await t.asRuntime();
    }
  });

  it("five leads per WhatsApp number in 24 hours: the sixth is refused with 429 and stores nothing, and another number is unaffected", async () => {
    const number = "644444444";
    for (let i = 0; i < 5; i++) expect(await createLead(deps(), { idempotencyKey: crypto.randomUUID(), body: quick({ whatsapp: number }) })).toMatchObject({ ok: true });
    const sixthKey = crypto.randomUUID();
    const sixth = await createLead(deps(), { idempotencyKey: sixthKey, body: quick({ whatsapp: number }) });
    expect(sixth).toMatchObject({ ok: false, status: 429, code: "RATE_LIMITED", fields: { reason: "number_limit" } });
    expect(await createLead(deps(), { idempotencyKey: crypto.randomUUID(), body: quick({ whatsapp: "644444445" }) })).toMatchObject({ ok: true });
    // Formatting does not dodge the limit: the same number typed another way is the same number.
    expect(await createLead(deps(), { idempotencyKey: crypto.randomUUID(), body: quick({ whatsapp: "+237 6 44 44 44 44" }) })).toMatchObject({ ok: false, status: 429 });
    await t.asOwner();
    try {
      expect(await count(`select count(*) as n from lead where idempotency_key = ${q(sixthKey)}`)).toBe(0);
      expect(await count(`select count(*) as n from lead where whatsapp_e164 = '+237644444444'`)).toBe(5);
    } finally {
      await t.asRuntime();
    }
  });

  it("leads older than 24 hours do not count toward the number limit", async () => {
    await t.asOwner();
    for (let i = 0; i < 5; i++) {
      await insertRow(t, "lead", {
        id: uuidv7(),
        ref: freshRef(),
        client_ref: "SC-ABCDE-FGHJK",
        idempotency_key: crypto.randomUUID(),
        payload_hash: "a".repeat(64),
        name: "Old",
        whatsapp_e164: "+237655555555",
        country_code: "CM",
        intake_kind: "quick",
        consent_notice_version: "v1",
        consent_at: "2026-10-19T12:00:00Z",
        received_at: "2026-10-19T12:00:00Z",
        sla_due_at: "2026-10-19T16:00:00Z",
        sla_hours_applied: 4,
      });
    }
    await t.asRuntime();
    expect(await createLead(deps(), { idempotencyKey: crypto.randomUUID(), body: quick({ whatsapp: "655555555" }) })).toMatchObject({ ok: true, status: 201 });
  });

  it("an unknown programme is refused and stores no lead", async () => {
    const key = crypto.randomUUID();
    const outcome = await createLead(deps(), { idempotencyKey: key, body: full({ programme_ids: [ids.p1, ids.p2, "0194f3c2-8a4b-7c1d-9e2f-3a4b5c6d7eff"] }) });
    expect(outcome).toMatchObject({ ok: false, status: 400, fields: { programme_ids: "UNKNOWN_VALUE" } });
    await t.asOwner();
    try {
      expect(await count(`select count(*) as n from lead where idempotency_key = ${q(key)}`)).toBe(0);
    } finally {
      await t.asRuntime();
    }
  });

  it("the runtime role cannot insert a lead or read one directly: the function is the only way in (ADR-038)", async () => {
    await expect(t.run(`insert into lead (id) values (gen_random_uuid())`)).rejects.toThrow();
    expect(await count(`select count(*) as n from lead`)).toBe(0); // no row level security context, so no row is visible
  });
});

describe("S4.5: wa_tap rows, the daily cap, and linking (architecture 7.5, owner decision D7)", () => {
  const tap = (leadRef: string) => ({ leadRef, sessionId: "abcdef0123456789", universityId: null, pageGroup: "university", country: "CM", occurredAt: null });

  it("stores at most 10 taps per reference per WAT day: the 11th is not stored, and the call does not fail", async () => {
    expect(WA_TAP_DAILY_CAP).toBe(10);
    const ref = freshRef();
    const stored = await recordWaTaps(t.db, Array.from({ length: 11 }, () => tap(ref)));
    expect(stored).toBe(10);
    expect(await recordWaTaps(t.db, [tap(ref)])).toBe(0);
    // Another reference has its own allowance.
    expect(await recordWaTaps(t.db, [tap(freshRef())])).toBe(1);
    await t.asOwner();
    try {
      expect(await count(`select count(*) as n from event where lead_ref = ${q(ref)} and type = 'wa_tap'`)).toBe(10);
    } finally {
      await t.asRuntime();
    }
  });

  it("accepts a reference with no lead yet, and links the rows when the lead arrives", async () => {
    const clientRef = freshRef();
    expect(await recordWaTaps(t.db, [tap(clientRef), tap(clientRef)])).toBe(2);
    await t.asOwner();
    try {
      expect(await count(`select count(*) as n from event where lead_ref = ${q(clientRef)} and lead_id is null`)).toBe(2);
    } finally {
      await t.asRuntime();
    }
    const key = crypto.randomUUID();
    expect(await createLead(deps(), { idempotencyKey: key, body: quick({ client_ref: clientRef, whatsapp: "666666666" }) })).toMatchObject({ ok: true });
    await t.asOwner();
    try {
      expect(await count(`select count(*) as n from event e join lead l on l.id = e.lead_id where e.lead_ref = ${q(clientRef)} and l.idempotency_key = ${q(key)}`)).toBe(2);
    } finally {
      await t.asRuntime();
    }
  });

  it("ignores a malformed reference and stores the two-letter country only", async () => {
    expect(await recordWaTaps(t.db, [{ ...tap("not-a-reference"), leadRef: "not-a-reference" }])).toBe(0);
    const ref = freshRef();
    await recordWaTaps(t.db, [{ ...tap(ref), country: "Nigeria" }]);
    await t.asOwner();
    try {
      const [row] = (await t.run(`select country, session_id from event where lead_ref = ${q(ref)}`)) as { country: string | null; session_id: string }[];
      expect(row?.country).toBeNull();
      expect(row?.session_id).toBe("abcdef0123456789");
    } finally {
      await t.asRuntime();
    }
  });

  it("page views, form events and installs create no rows; only the one tap does (the Stage 4 exit criterion)", async () => {
    await t.asOwner();
    const before = await count(`select count(*) as n from event`);
    await t.asRuntime();
    const ref = freshRef();
    const plan = planEvents(
      [{ type: "page_view" }, { type: "form_start" }, { type: "form_submit" }, { type: "install" }, { type: "wa_tap" }, { type: "wa_tap", lead_ref: ref }],
      { country: "CM", now: NOW, collectPageViews: true },
    );
    expect(await recordWaTaps(t.db, plan.taps)).toBe(1);
    await t.asOwner();
    try {
      expect(await count(`select count(*) as n from event`)).toBe(before + 1);
      expect(await count(`select count(*) as n from event where type <> 'wa_tap'`)).toBe(0);
    } finally {
      await t.asRuntime();
    }
  });
});
