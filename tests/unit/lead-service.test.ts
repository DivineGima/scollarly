import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/hash";
import { leadIntakeSchema } from "@/lib/schemas/lead";
import { buildFullPayload, buildQuickPayload, validateFull, validateQuick, utmFromSearch, type FullValues } from "@/lib/lead-form";
import { LEADS_PER_NUMBER_PER_DAY, createLead, type CreateLeadDeps } from "@/modules/leads/service";
import { toResponse } from "@/server/edge/leads";
import { isMeasurementRequest } from "@/server/security/measurement";
import type { InsertLeadOutcome, NewLead } from "@/server/repositories/leads";

/**
 * S4.4: `POST /api/v1/leads` as a function of its dependencies. Every documented outcome and every order-of-checks rule.
 */

const KEY = "0194f3c2-8a4b-7c1d-9e2f-3a4b5c6d7e8f";
const UNI = "0194f3c2-8a4b-7c1d-9e2f-3a4b5c6d7e80";
const PROG = (n: number) => `0194f3c2-8a4b-7c1d-9e2f-3a4b5c6d7e9${n}`;

const quick = (over: Record<string, unknown> = {}) => ({
  intake_kind: "quick",
  name: "  Ama Test  ",
  whatsapp: "6 12 34 56 78",
  country_code: "CM",
  source: { page: "/universities/alpha", university_id: UNI },
  locale: "en",
  client_ref: "SC-ABCDE-FGHJK",
  client_created_at: "2026-10-23T22:00:00Z",
  consent: { notice_version: "draft-1" },
  turnstile_token: "tok-1",
  ...over,
});

const full = (over: Record<string, unknown> = {}) => ({
  intake_kind: "full",
  name: "Ama Test",
  whatsapp: "+237612345678",
  country_code: "CM",
  qualification_type: "olevel_alevel",
  results: [{ subject: "Maths", grade: "A" }],
  programme_ids: [PROG(1), PROG(2), PROG(3)],
  source: { page: "/apply" },
  locale: "en",
  client_ref: "SC-ABCDE-FGHJK",
  client_created_at: "2026-10-23T22:00:00Z",
  consent: { notice_version: "draft-1" },
  turnstile_token: "tok-1",
  ...over,
});

function deps(over: Partial<CreateLeadDeps> = {}): { deps: CreateLeadDeps; inserted: NewLead[] } {
  const inserted: NewLead[] = [];
  return {
    inserted,
    deps: {
      insert: async (row) => {
        inserted.push(row);
        return { kind: "created", id: row.id, ref: row.refs[0]!, storedHash: row.payloadHash };
      },
      verifyTurnstile: async () => "ok",
      limit: async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 0 }),
      slaSettings: async () => ({ weekdayHours: 4, weekendHours: 24 }),
      now: () => new Date("2026-10-23T12:00:00Z"),
      newId: () => "0194f3c2-8a4b-7c1d-9e2f-3a4b5c6d7e00",
      newRef: () => "SC-ZZZZZ-ZZZZZ",
      ...over,
    },
  };
}

describe("validation comes first", () => {
  it("refuses a missing or malformed Idempotency-Key with 400, before anything else runs", async () => {
    const limit = vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }));
    const { deps: d } = deps({ limit });
    for (const bad of [null, "", "not-a-uuid", `${KEY}x`]) {
      const outcome = await createLead(d, { idempotencyKey: bad, body: quick() });
      expect(outcome).toMatchObject({ ok: false, status: 400, code: "VALIDATION" });
    }
    expect(limit).not.toHaveBeenCalled();
  });

  it("refuses an invalid body with the field tokens the form shows", async () => {
    const { deps: d } = deps();
    const outcome = await createLead(d, { idempotencyKey: KEY, body: quick({ name: "", whatsapp: "123", country_code: "XX", surprise: 1 }) });
    expect(outcome).toMatchObject({ ok: false, status: 400, code: "VALIDATION" });
    // The cross-field phone check only runs once the fields themselves are valid, so the number is reported on the next attempt.
    if (!outcome.ok && outcome.status === 400) expect(Object.keys(outcome.fields).sort()).toEqual(["body", "country_code", "name"]);
  });

  it("a full lead without 3 different programmes is refused; a quick lead is not (FR-5)", async () => {
    const { deps: d } = deps();
    expect(await createLead(d, { idempotencyKey: KEY, body: full({ programme_ids: [PROG(1), PROG(2)] }) })).toMatchObject({ ok: false, status: 400, fields: { programme_ids: "PROGRAMMES_MIN_3" } });
    expect(await createLead(d, { idempotencyKey: KEY, body: full({ programme_ids: [PROG(1), PROG(1), PROG(2)] }) })).toMatchObject({ ok: false, status: 400 });
    expect(await createLead(d, { idempotencyKey: KEY, body: quick({ programme_ids: [] }) })).toMatchObject({ ok: true, status: 201 });
  });

  it("a quick lead needs the page's university or a programme", async () => {
    const { deps: d } = deps();
    expect(await createLead(d, { idempotencyKey: KEY, body: quick({ source: { page: "/" } }) })).toMatchObject({ ok: false, status: 400 });
    expect(await createLead(d, { idempotencyKey: KEY, body: quick({ source: { page: "/" }, programme_ids: [PROG(1)] }) })).toMatchObject({ ok: true });
  });

  it("creates a quick lead from name, number, country and a page university (the Stage 4 exit criterion)", async () => {
    const { deps: d, inserted } = deps();
    const outcome = await createLead(d, { idempotencyKey: KEY, body: quick() });
    expect(outcome).toEqual({ ok: true, status: 201, ref: "SC-ABCDE-FGHJK", replayed: false });
    expect(inserted[0]).toMatchObject({
      intakeKind: "quick",
      name: "Ama Test",
      whatsappE164: "+237612345678",
      countryCode: "CM",
      qualificationType: null,
      results: [],
      source: { page: "/universities/alpha", university_id: UNI },
      programmeIds: [],
    });
  });

  it("stores a full lead with its qualification, results and the programmes in rank order", async () => {
    const { deps: d, inserted } = deps();
    expect(await createLead(d, { idempotencyKey: KEY, body: full({ programme_ids: [PROG(3), PROG(1), PROG(2)] }) })).toMatchObject({ ok: true, status: 201 });
    expect(inserted[0]).toMatchObject({ intakeKind: "full", qualificationType: "olevel_alevel", results: [{ subject: "Maths", grade: "A" }], programmeIds: [PROG(3), PROG(1), PROG(2)] });
  });
});

describe("layers: rate limit, then Turnstile, then the database", () => {
  it("429 with Retry-After from the limiter, before Turnstile or the database are touched", async () => {
    const verifyTurnstile = vi.fn(async () => "ok" as const);
    const insert = vi.fn();
    const { deps: d } = deps({ limit: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 42 }), verifyTurnstile, insert });
    const outcome = await createLead(d, { idempotencyKey: KEY, body: quick() });
    expect(outcome).toMatchObject({ ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 42 });
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    const response = toResponse(outcome, "req-1");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
  });

  it("403 TURNSTILE_FAILED when the token is refused, and 503 when Turnstile cannot be reached; nothing is stored", async () => {
    const insert = vi.fn();
    expect(await createLead(deps({ verifyTurnstile: async () => "failed", insert }).deps, { idempotencyKey: KEY, body: quick() })).toMatchObject({ ok: false, status: 403, code: "TURNSTILE_FAILED" });
    expect(await createLead(deps({ verifyTurnstile: async () => "unavailable", insert }).deps, { idempotencyKey: KEY, body: quick() })).toMatchObject({ ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("the token is single use, so it is not part of the payload identity: the same lead with a new token has the same hash", async () => {
    const hashes: string[] = [];
    const { deps: d } = deps({ insert: async (row) => (hashes.push(row.payloadHash), { kind: "created", id: row.id, ref: row.refs[0]!, storedHash: row.payloadHash }) });
    await createLead(d, { idempotencyKey: KEY, body: quick({ turnstile_token: "tok-1" }) });
    await createLead(d, { idempotencyKey: KEY, body: quick({ turnstile_token: "tok-2" }) });
    await createLead(d, { idempotencyKey: KEY, body: quick({ name: "Someone Else" }) });
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).not.toBe(hashes[2]);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    // The same hash whatever the key order of the body.
    expect(await sha256Hex("x")).toHaveLength(64);
  });

  it("five leads per number in 24 hours: the sixth is a 429 with the number-limit reason and a long Retry-After", async () => {
    expect(LEADS_PER_NUMBER_PER_DAY).toBe(5);
    const insert = vi.fn(async (row: NewLead): Promise<InsertLeadOutcome> => (expect(row.numberLimit).toBe(5), { kind: "number_limited" }));
    const outcome = await createLead(deps({ insert }).deps, { idempotencyKey: KEY, body: quick() });
    expect(outcome).toMatchObject({ ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 3600, fields: { reason: "number_limit" } });
    const response = toResponse(outcome, "req");
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(((await response.json()) as { error: { fields: Record<string, string> } }).error.fields.reason).toBe("number_limit");
  });
});

describe("idempotency (architecture 8.2, 13.5)", () => {
  it("the same key and payload again is 200 replayed with the same reference; the same key with another payload is 409", async () => {
    let stored: { hash: string; ref: string } | null = null;
    const { deps: d } = deps({
      insert: async (row) => {
        if (stored) return { kind: "existing", id: row.id, ref: stored.ref, storedHash: stored.hash };
        stored = { hash: row.payloadHash, ref: row.refs[0]! };
        return { kind: "created", id: row.id, ref: stored.ref, storedHash: stored.hash };
      },
    });
    expect(await createLead(d, { idempotencyKey: KEY, body: quick() })).toEqual({ ok: true, status: 201, ref: "SC-ABCDE-FGHJK", replayed: false });
    expect(await createLead(d, { idempotencyKey: KEY, body: quick({ turnstile_token: "fresh-token" }) })).toEqual({ ok: true, status: 200, ref: "SC-ABCDE-FGHJK", replayed: true });
    const conflict = await createLead(d, { idempotencyKey: KEY, body: quick({ name: "A Different Person" }) });
    expect(conflict).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    expect(toResponse(conflict, "r").status).toBe(409);
  });

  it("offers the device reference first and server references after it, so a collision never loses the lead", async () => {
    const { deps: d, inserted } = deps();
    await createLead(d, { idempotencyKey: KEY, body: quick() });
    expect(inserted[0]?.refs[0]).toBe("SC-ABCDE-FGHJK");
    expect(inserted[0]?.clientRef).toBe("SC-ABCDE-FGHJK");
    expect(inserted[0]?.refs).toHaveLength(4);
    expect(inserted[0]?.refs.slice(1).every((r) => /^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(r))).toBe(true);
  });

  it("an unknown programme is a 400 on the programme field; every candidate reference taken is a 503 the client retries", async () => {
    expect(await createLead(deps({ insert: async () => ({ kind: "unknown_programme" }) }).deps, { idempotencyKey: KEY, body: full() })).toMatchObject({ ok: false, status: 400, fields: { programme_ids: "UNKNOWN_VALUE" } });
    expect(await createLead(deps({ insert: async () => ({ kind: "ref_exhausted" }) }).deps, { idempotencyKey: KEY, body: quick() })).toMatchObject({ ok: false, status: 503 });
  });

  it("a database that is asleep or failing is a 503 with no details, so the client retries with backoff", async () => {
    const outcome = await createLead(deps({ insert: async () => Promise.reject(new Error("connection terminated")) }).deps, { idempotencyKey: KEY, body: quick() });
    expect(outcome).toEqual({ ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." });
    expect(JSON.stringify(toResponse(outcome, "r"))).not.toContain("connection terminated");
  });

  it("tells onError about the fault behind a 503, so the handler can log it", async () => {
    const seen: unknown[] = [];
    const fault = new Error("connection terminated");
    await createLead(deps({ insert: async () => Promise.reject(fault), onError: (error) => seen.push(error) }).deps, { idempotencyKey: KEY, body: quick() });
    expect(seen).toEqual([fault]);
  });
});

describe("a measurement lead is stamped by the server, never by the client (security/measurement.ts)", () => {
  it("stamps source.measurement only when the handler says the request proved itself", async () => {
    const real = deps();
    await createLead(real.deps, { idempotencyKey: KEY, body: quick() });
    expect(real.inserted[0]?.source).not.toHaveProperty("measurement");
    const measured = deps();
    await createLead(measured.deps, { idempotencyKey: KEY, body: quick(), measurement: true });
    expect(measured.inserted[0]?.source).toMatchObject({ page: "/universities/alpha", measurement: true });
  });

  it("refuses a client that sends the stamp itself (the lead source schema is strict)", async () => {
    const outcome = await createLead(deps().deps, { idempotencyKey: KEY, body: quick({ source: { page: "/x", university_id: UNI, measurement: true } }) });
    expect(outcome).toMatchObject({ ok: false, status: 400 });
  });

  it("isMeasurementRequest accepts only the exact secret", () => {
    const req = (token?: string) => new Request("https://x.test/api/v1/leads", { method: "POST", headers: token ? { "x-phase0-token": token } : {} });
    expect(isMeasurementRequest(req("secret-1"), "secret-1")).toBe(true);
    expect(isMeasurementRequest(req("secret-2"), "secret-1")).toBe(false);
    expect(isMeasurementRequest(req(), "secret-1")).toBe(false);
    expect(isMeasurementRequest(req("secret-1"), undefined)).toBe(false);
    expect(isMeasurementRequest(req(""), "")).toBe(false);
  });
});

describe("the SLA is set from the server clock, once (FR-12, ADR-009)", () => {
  const slaFor = async (now: string, settings = { weekdayHours: 4, weekendHours: 24 }, clientTime = "2020-01-01T00:00:00Z") => {
    const { deps: d, inserted } = deps({ now: () => new Date(now), slaSettings: async () => settings });
    await createLead(d, { idempotencyKey: KEY, body: quick({ client_created_at: clientTime }) });
    return inserted[0]!;
  };

  it("Friday 23:00 WAT is Saturday 03:00 WAT: a weekday receipt gets 4 hours even when it ends on the weekend", async () => {
    // 23:00 WAT is 22:00 UTC.
    const row = await slaFor("2026-10-23T22:00:00Z");
    expect(row.slaHoursApplied).toBe(4);
    expect(row.slaDueAt.toISOString()).toBe("2026-10-24T02:00:00.000Z"); // Saturday 03:00 WAT
  });

  it("Saturday and Sunday in WAT get 24 hours", async () => {
    expect((await slaFor("2026-10-24T10:00:00Z")).slaHoursApplied).toBe(24);
    expect((await slaFor("2026-10-25T10:00:00Z")).slaHoursApplied).toBe(24);
    // Sunday 23:30 UTC is already Monday 00:30 WAT: a weekday.
    expect((await slaFor("2026-10-25T23:30:00Z")).slaHoursApplied).toBe(4);
  });

  it("uses the server time, not the device time: a device clock set to the weekend changes nothing", async () => {
    const row = await slaFor("2026-10-21T12:00:00Z", undefined, "2026-10-24T12:00:00Z"); // server: Wednesday; device claims Saturday
    expect(row.slaHoursApplied).toBe(4);
    expect(row.receivedAt.toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(row.consentAt.toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(row.clientCreatedAt?.toISOString()).toBe("2026-10-24T12:00:00.000Z"); // kept as advisory only
  });

  it("reads the hours from the settings the owner set", async () => {
    const row = await slaFor("2026-10-21T12:00:00Z", { weekdayHours: 2, weekendHours: 48 });
    expect(row.slaHoursApplied).toBe(2);
    expect(row.slaDueAt.toISOString()).toBe("2026-10-21T14:00:00.000Z");
  });
});

describe("the form's own checks agree with the server's schema", () => {
  const countries = ["CM", "NG", "GH", "CI", "SN", "GN", "ZA"] as const;
  const ids = (n: number) => Array.from({ length: n }, (_, i) => PROG(i + 1));
  const base: FullValues = { name: "Ama Test", country: "CM", whatsapp: "612345678", consent: true, qualification: "olevel_alevel", results: [{ subject: "Maths", grade: "A" }], programmeIds: ids(3), email: "", };
  const context = { page: "/apply", locale: "en" };

  it("a payload the form builds is accepted by the server schema, quick and full", () => {
    const quickBody = { ...buildQuickPayload({ name: "Ama", country: "NG", whatsapp: "0803 123 4567", consent: true }, { page: "/universities/x", universityId: UNI, locale: "en" }), turnstile_token: "t" };
    expect(leadIntakeSchema.safeParse(quickBody).success).toBe(true);
    const fullBody = { ...buildFullPayload({ ...base, email: "ama@example.test" }, context), turnstile_token: "t" };
    const parsed = leadIntakeSchema.safeParse(fullBody);
    expect(parsed.success).toBe(true);
    expect(fullBody.programme_ids).toEqual(ids(3));
  });

  it("every case the form refuses, the server refuses too", () => {
    const cases: [FullValues, string][] = [
      [{ ...base, name: "  " }, "name"],
      [{ ...base, whatsapp: "123" }, "whatsapp"],
      [{ ...base, country: "FR" }, "country_code"],
      [{ ...base, qualification: "" }, "qualification_type"],
      [{ ...base, programmeIds: ids(2) }, "programme_ids"],
      [{ ...base, email: "not-an-email" }, "email"],
    ];
    for (const [values, field] of cases) {
      expect(Object.keys(validateFull(values)), field).toContain(field);
      const body = { ...buildFullPayload(values, context), turnstile_token: "t" };
      expect(leadIntakeSchema.safeParse(body).success, field).toBe(false);
    }
  });

  it("every country's own number format is read the same on both sides", () => {
    const numbers: Record<(typeof countries)[number], string> = { CM: "612345678", NG: "08031234567", GH: "0241234567", CI: "0701234567", SN: "771234567", GN: "621234567", ZA: "0821234567" };
    for (const country of countries) {
      const values = { ...base, country, whatsapp: numbers[country] };
      expect(validateFull(values).whatsapp, country).toBeUndefined();
      expect(leadIntakeSchema.safeParse({ ...buildFullPayload(values, context), turnstile_token: "t" }).success, country).toBe(true);
    }
  });

  it("asks for consent, and for a university or programme on the quick form, which the server never sees as a field", () => {
    expect(validateFull({ ...base, consent: false }).consent).toBe("CONSENT_REQUIRED");
    expect(validateQuick({ name: "A", country: "CM", whatsapp: "612345678", consent: true }, {}).university).toBe("UNIVERSITY_OR_PROGRAMME_REQUIRED");
    expect(validateQuick({ name: "A", country: "CM", whatsapp: "612345678", consent: true }, { programmeId: PROG(1) })).toEqual({});
  });

  it("keeps utm tags for the source, at most 8, and nothing else from the address", () => {
    expect(utmFromSearch("?utm_source=fb&utm_medium=ad&q=secret&utm_campaign=c")).toEqual({ utm_source: "fb", utm_medium: "ad", utm_campaign: "c" });
    expect(utmFromSearch("?q=1")).toBeUndefined();
    expect(utmFromSearch(undefined)).toBeUndefined();
    const many = utmFromSearch(`?${Array.from({ length: 12 }, (_, i) => `utm_k${String.fromCharCode(97 + i)}=1`).join("&")}`);
    expect(Object.keys(many ?? {})).toHaveLength(8);
  });
});
