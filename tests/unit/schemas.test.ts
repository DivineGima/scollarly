import { describe, expect, it } from "vitest";
import { errorResponseFor, fieldErrors, STATUS_BY_CODE, validationErrorResponse } from "@/lib/http";
import { translationsSchema, idempotencyKeySchema, V } from "@/lib/schemas/common";
import { leadIntakeSchema } from "@/lib/schemas/lead";
import { uuidv7 } from "@/lib/uuid";

const programmes = (n: number) => Array.from({ length: n }, () => uuidv7());

const base = {
  name: "Amina Bello",
  whatsapp: "0803 123 4567",
  country_code: "NG",
  locale: "en",
  client_ref: "SC-ABCDE-FGHJK",
  client_created_at: "2026-10-23T22:00:00Z",
  consent: { notice_version: "2026-10" },
  turnstile_token: "token",
};

const full = (over: Record<string, unknown> = {}) => ({ intake_kind: "full", ...base, qualification_type: "olevel_alevel", results: [{ subject: "Maths", grade: "A" }], programme_ids: programmes(3), ...over });
const quick = (over: Record<string, unknown> = {}) => ({ intake_kind: "quick", ...base, source: { university_id: uuidv7(), page: "/universities/jain" }, ...over });

const issues = (input: unknown) => {
  const result = leadIntakeSchema.safeParse(input);
  return result.success ? null : fieldErrors(result.error.issues);
};

describe("lead intake schema: the full form (A5)", () => {
  it("accepts a complete full lead and applies the defaults", () => {
    const parsed = leadIntakeSchema.parse(full({ results: undefined }));
    expect(parsed.intake_kind).toBe("full");
    expect(parsed).toMatchObject({ results: [], source: {}, name: "Amina Bello" });
  });

  it("needs at least 3 different programmes", () => {
    expect(issues(full({ programme_ids: programmes(2) }))).toEqual({ programme_ids: V.PROGRAMMES_MIN_3 });
    expect(issues(full({ programme_ids: [] }))).toEqual({ programme_ids: V.PROGRAMMES_MIN_3 });
    const a = uuidv7();
    expect(issues(full({ programme_ids: [a, a, uuidv7()] }))).toMatchObject({ programme_ids: V.DUPLICATE });
    expect(issues(full({ programme_ids: programmes(3) }))).toBeNull();
    expect(issues(full({ programme_ids: programmes(5) }))).toBeNull();
  });

  it("needs a qualification type, and only the two known ones", () => {
    expect(issues(full({ qualification_type: undefined }))).toMatchObject({ qualification_type: V.REQUIRED });
    expect(issues(full({ qualification_type: "degree" }))).toMatchObject({ qualification_type: V.REQUIRED });
    expect(issues(full({ qualification_type: "grade10_11" }))).toBeNull();
  });

  it("limits the programme and result lists", () => {
    expect(issues(full({ programme_ids: programmes(21) }))).toMatchObject({ programme_ids: V.TOO_LONG });
    expect(issues(full({ results: Array.from({ length: 31 }, () => ({ subject: "S", grade: "A" })) }))).toMatchObject({ results: V.TOO_LONG });
    expect(issues(full({ results: [{ subject: "", grade: "A" }] }))).toMatchObject({ "results.0.subject": V.REQUIRED });
  });
});

describe("lead intake schema: the quick form (A5b, ADR-030)", () => {
  it("accepts name, number, country and the page's university, with no qualification", () => {
    const parsed = leadIntakeSchema.parse(quick());
    expect(parsed.intake_kind).toBe("quick");
    expect(parsed).not.toHaveProperty("qualification_type");
  });

  it("accepts one programme instead of a university", () => {
    expect(issues(quick({ source: {}, programme_ids: programmes(1) }))).toBeNull();
  });

  it("refuses a quick lead with neither a university nor a programme", () => {
    expect(issues(quick({ source: {} }))).toEqual({ "source.university_id": V.UNIVERSITY_OR_PROGRAMME_REQUIRED });
    expect(issues(quick({ source: { page: "/" }, programme_ids: [] }))).toEqual({ "source.university_id": V.UNIVERSITY_OR_PROGRAMME_REQUIRED });
  });

  it("rejects fields that belong to the full form (unknown fields are refused)", () => {
    expect(issues(quick({ qualification_type: "olevel_alevel" }))).not.toBeNull();
    expect(issues(quick({ results: [] }))).not.toBeNull();
  });
});

describe("lead intake schema: both kinds", () => {
  it("refuses unknown fields anywhere, including inside source and consent", () => {
    expect(issues(full({ extra: 1 }))).not.toBeNull();
    expect(issues(full({ source: { university_id: uuidv7(), extra: 1 } }))).not.toBeNull();
    expect(issues(full({ consent: { notice_version: "v1", extra: 1 } }))).not.toBeNull();
  });

  it("refuses a number that does not fit the chosen country", () => {
    expect(issues(full({ whatsapp: "123" }))).toEqual({ whatsapp: V.PHONE_INVALID });
    expect(issues(full({ whatsapp: "abc" }))).toEqual({ whatsapp: V.PHONE_INVALID });
    expect(issues(full({ whatsapp: "+234 803 123 456" }))).toEqual({ whatsapp: V.PHONE_INVALID });
    expect(issues(full({ whatsapp: "+237 651 232 301", country_code: "CM" }))).toBeNull();
  });

  it("requires name, number, country, locale, client reference, time, consent and Turnstile token", () => {
    for (const field of ["name", "whatsapp", "country_code", "locale", "client_ref", "client_created_at", "consent", "turnstile_token"]) {
      expect(issues(full({ [field]: undefined })), field).not.toBeNull();
    }
    expect(issues(full({ name: "   " }))).toMatchObject({ name: V.REQUIRED });
    expect(issues(full({ turnstile_token: "" }))).toMatchObject({ turnstile_token: V.REQUIRED });
  });

  it("accepts only the seven student countries and the active locale", () => {
    for (const country of ["CM", "NG", "GH", "CI", "SN", "GN", "ZA"]) {
      expect(issues(full({ country_code: country, whatsapp: "+237 651 232 301" })), country).toBeNull();
    }
    expect(issues(full({ country_code: "KE" }))).toMatchObject({ country_code: V.UNKNOWN_VALUE });
    expect(issues(full({ country_code: "ng" }))).toMatchObject({ country_code: V.UNKNOWN_VALUE });
    expect(issues(full({ locale: "fr" }))).toMatchObject({ locale: V.UNKNOWN_VALUE });
  });

  it("validates the reference, the time and the email", () => {
    expect(issues(full({ client_ref: "SC-ABCDE-FGHIJ" }))).toMatchObject({ client_ref: V.INVALID });
    expect(issues(full({ client_created_at: "yesterday" }))).toMatchObject({ client_created_at: V.INVALID });
    expect(issues(full({ client_created_at: "2026-10-23T22:00:00+01:00" }))).toBeNull();
    expect(issues(full({ email: "not an email" }))).toMatchObject({ email: V.INVALID });
    expect(issues(full({ email: "amina@example.com" }))).toBeNull();
  });

  it("limits text lengths", () => {
    expect(issues(full({ name: "x".repeat(101) }))).toMatchObject({ name: V.TOO_LONG });
    expect(issues(full({ source: { page: "/".repeat(201) } }))).toMatchObject({ "source.page": V.TOO_LONG });
    const utm = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, "v"]));
    expect(issues(full({ source: { utm } }))).not.toBeNull();
  });

  it("refuses an unknown or missing intake kind", () => {
    expect(issues({ ...full(), intake_kind: "other" })).not.toBeNull();
    expect(issues({ ...full(), intake_kind: undefined })).not.toBeNull();
    expect(issues("not an object")).not.toBeNull();
    expect(issues(null)).not.toBeNull();
  });
});

describe("common schemas", () => {
  it("idempotencyKeySchema takes a UUID only", () => {
    expect(idempotencyKeySchema.safeParse(uuidv7()).success).toBe(true);
    expect(idempotencyKeySchema.safeParse("abc").success).toBe(false);
  });

  it("translationsSchema requires English and allows other locales", () => {
    expect(translationsSchema.safeParse({ en: "Fees", fr: "Frais" }).success).toBe(true);
    expect(translationsSchema.safeParse({ fr: "Frais" }).success).toBe(false);
    expect(translationsSchema.safeParse({ en: "" }).success).toBe(false);
    expect(translationsSchema.safeParse({ en: "Fees", fr: 5 }).success).toBe(false);
  });
});

describe("error envelope helpers (architecture 8.1)", () => {
  it("fieldErrors keeps the first message per dotted path and names a root problem 'body'", () => {
    expect(fieldErrors([{ path: ["a", 0, "b"], message: "X" }, { path: ["a", 0, "b"], message: "Y" }, { path: [], message: "Z" }])).toEqual({ "a.0.b": "X", body: "Z" });
  });

  it("builds the envelope with the standard status, request id and no-store", async () => {
    const response = errorResponseFor("RATE_LIMITED", "Slow down.", "req-1", { headers: { "Retry-After": "60" } });
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toEqual({ error: { code: "RATE_LIMITED", message: "Slow down." }, request_id: "req-1" });
  });

  it("maps every code to a status and validation errors to 400 with fields", async () => {
    expect(Object.keys(STATUS_BY_CODE)).toHaveLength(12); // CONFLICT and STEP_UP_REQUIRED were added in Stage 2
    expect([STATUS_BY_CODE.CONFLICT, STATUS_BY_CODE.STEP_UP_REQUIRED]).toEqual([409, 403]);
    const response = validationErrorResponse([{ path: ["name"], message: V.REQUIRED }], "req-2");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION", fields: { name: "REQUIRED" } }, request_id: "req-2" });
  });
});
