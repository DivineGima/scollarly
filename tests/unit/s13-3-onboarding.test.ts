import { describe, expect, it, vi } from "vitest";
import { COURSE_FIELDS } from "@/lib/courses";
import { CONSENT_NOTICE_VERSION } from "@/lib/lead-form";
import { fieldErrors } from "@/lib/http";
import { buildOnboardingPayload, courseFromSearch, emptyValues, type OnboardingValues } from "@/modules/onboarding/payload";
import { effectiveAnswers, firstIncompleteStep, progressOf, STEP_FIELDS, STEPS_FOR, validateStep } from "@/modules/onboarding/questions";
import { onboardingBodySchema } from "@/modules/onboarding/schema";
import { completeOnboarding, type CompleteOnboardingDeps } from "@/modules/onboarding/service";
import { toResponse } from "@/modules/onboarding/endpoints";
import { intakeYears, validateAnswers } from "@/modules/onboarding/validate";
import type { NewProfile, ProfileOutcome } from "@/server/repositories/onboarding";
import type { QueuedLead } from "@/offline/logic";
import { sendLead } from "@/offline/send";
import { syncOnce, type SyncDeps } from "@/offline/sync-engine";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S13.3 (architecture 21.6, ADR-043): the questionnaire's rules, the request it builds, the server decision behind
 * `POST /api/v1/me/onboarding`, and the way a finished questionnaire travels through the offline queue. The database side is in
 * tests/integration/s13-3-onboarding.test.ts; the screens are driven by tests/e2e/s13-3-onboarding.spec.ts.
 */

const studentValues = (over: Partial<OnboardingValues> = {}): OnboardingValues => ({
  ...emptyValues("student"),
  applicant_name: "Ada Eze",
  applicant_country: "NG",
  contact_whatsapp: "+2348031234567",
  qualification_type: "olevel_alevel",
  results: [{ subject: "Mathematics", grade: "A" }],
  level: "undergraduate",
  course_fields: ["computer_science_it"],
  intake_year: 2027,
  consent: true,
  ...over,
});

const parentValues = (over: Partial<OnboardingValues> = {}): OnboardingValues =>
  studentValues({
    relationship: "parent",
    applicant_name: "Chidi Eze",
    applicant_country: "NG",
    contact_name: "Ngozi Eze",
    contact_country: "CM",
    contact_whatsapp: "+237671234567",
    ...over,
  });

const CONTEXT = { locale: "en" };

describe("the answers (21.6)", () => {
  it("accepts a complete student and a complete parent", () => {
    expect(validateAnswers(effectiveAnswers(studentValues()))).toEqual({});
    expect(validateAnswers(effectiveAnswers(parentValues()))).toEqual({});
  });

  it("asks for what is missing, with the message tokens the screens translate", () => {
    const errors = validateAnswers(effectiveAnswers(emptyValues("student")));
    expect(errors).toMatchObject({
      applicant_name: "REQUIRED",
      applicant_country: "REQUIRED",
      contact_whatsapp: "REQUIRED",
      qualification_type: "REQUIRED",
      level: "REQUIRED",
      course_fields: "REQUIRED",
      intake_year: "REQUIRED",
    });
  });

  it("checks the number against the contact's own country, and accepts a number typed with its country code", () => {
    expect(validateAnswers(effectiveAnswers(studentValues({ contact_whatsapp: "12345" })))).toMatchObject({ contact_whatsapp: "PHONE_INVALID" });
    expect(validateAnswers(effectiveAnswers(studentValues({ contact_whatsapp: "0803 123 4567" })))).toEqual({});
    // A parent in Cameroon with a Cameroon number, for a child in Nigeria: the number is read for Cameroon.
    expect(validateAnswers(effectiveAnswers(parentValues({ contact_whatsapp: "6 71 23 45 67" })))).toEqual({});
    expect(validateAnswers(effectiveAnswers(parentValues({ contact_country: "" })))).toMatchObject({ contact_country: "REQUIRED", contact_whatsapp: "PHONE_INVALID" });
  });

  it("limits the courses to one to five known, different fields", () => {
    expect(validateAnswers(effectiveAnswers(studentValues({ course_fields: [] })))).toMatchObject({ course_fields: "REQUIRED" });
    expect(validateAnswers(effectiveAnswers(studentValues({ course_fields: COURSE_FIELDS.slice(0, 6) as unknown as string[] })))).toMatchObject({ course_fields: "TOO_LONG" });
    expect(validateAnswers(effectiveAnswers(studentValues({ course_fields: ["law", "law"] })))).toMatchObject({ course_fields: "DUPLICATE" });
    expect(validateAnswers(effectiveAnswers(studentValues({ course_fields: ["astrology"] })))).toMatchObject({ course_fields: "UNKNOWN_VALUE" });
    expect(validateAnswers(effectiveAnswers(studentValues({ course_fields: COURSE_FIELDS.slice(0, 5) as unknown as string[] })))).toEqual({});
  });

  it("treats the grades as optional, drops a blank row, and flags a half-filled one", () => {
    expect(validateAnswers(effectiveAnswers(studentValues({ results: [] })))).toEqual({});
    expect(validateAnswers(effectiveAnswers(studentValues({ results: [{ subject: "", grade: "" }] })))).toEqual({});
    expect(validateAnswers(effectiveAnswers(studentValues({ results: [{ subject: "Physics", grade: "" }] })))).toMatchObject({ results: "INVALID" });
    expect(validateAnswers(effectiveAnswers(studentValues({ results: [{ subject: "x".repeat(61), grade: "A" }] })))).toMatchObject({ results: "TOO_LONG" });
  });

  it("offers this year and the next two, and refuses a year outside the database range", () => {
    expect(intakeYears(new Date("2026-11-02T00:00:00Z"))).toEqual([2026, 2027, 2028]);
    expect(validateAnswers(effectiveAnswers(studentValues({ intake_year: 1999 })))).toMatchObject({ intake_year: "INVALID" });
    expect(validateAnswers(effectiveAnswers(studentValues({ intake_year: 2027.5 })))).toMatchObject({ intake_year: "INVALID" });
  });

  it("makes a student their own contact, and refuses a body that says otherwise", () => {
    expect(effectiveAnswers(studentValues())).toMatchObject({ contact_name: "Ada Eze", contact_country: "NG" });
    const forged = validateAnswers({ ...effectiveAnswers(studentValues()), contact_name: "Someone Else" });
    expect(forged).toMatchObject({ contact_name: "INVALID" });
  });
});

describe("the screens", () => {
  it("shows a student four screens and a parent five, in order, with the consent last", () => {
    expect(STEPS_FOR.student).toEqual(["basics", "results", "plan", "consent"]);
    expect(STEPS_FOR.parent).toEqual(["who", "results", "plan", "contact", "consent"]);
    expect(progressOf("parent", "plan")).toEqual({ position: 3, total: 5 });
    expect(progressOf("student", "basics")).toEqual({ position: 1, total: 4 });
  });

  it("owns every answer on exactly one screen of each flow, so Next never blocks on a screen the person has not reached", () => {
    for (const relationship of ["student", "parent"] as const) {
      const owned = STEPS_FOR[relationship].flatMap((step) => STEP_FIELDS[step]);
      for (const field of ["applicant_name", "applicant_country", "contact_whatsapp", "qualification_type", "results", "level", "course_fields", "intake_year", "consent"]) {
        expect(owned.filter((f) => f === field), `${relationship}: ${field}`).toHaveLength(1);
      }
    }
    expect(STEPS_FOR.parent.flatMap((s) => STEP_FIELDS[s])).toEqual(expect.arrayContaining(["contact_name", "contact_country"]));
  });

  it("reports only the errors of the screen being left", () => {
    const empty = emptyValues("student");
    expect(Object.keys(validateStep("basics", empty)).sort()).toEqual(["applicant_country", "applicant_name", "contact_whatsapp"]);
    expect(Object.keys(validateStep("plan", empty)).sort()).toEqual(["course_fields", "intake_year", "level"]);
    expect(validateStep("consent", empty)).toEqual({ consent: "CONSENT_REQUIRED" });
    expect(validateStep("consent", studentValues())).toEqual({});
  });

  it("sends a person who skipped a screen back to the first incomplete one", () => {
    expect(firstIncompleteStep("student", studentValues())).toBeNull();
    expect(firstIncompleteStep("student", studentValues({ level: "" }))).toBe("plan");
    expect(firstIncompleteStep("student", studentValues({ consent: false }))).toBe("consent");
    expect(firstIncompleteStep("parent", parentValues({ contact_name: "" }))).toBe("contact");
    expect(firstIncompleteStep("parent", parentValues())).toBeNull();
  });

  it("starts the study plan with the course chosen on the landing page, and ignores one that is not on the list", () => {
    expect(emptyValues("student", "law").course_fields).toEqual(["law"]);
    expect(courseFromSearch("?as=student&course=law")).toBe("law");
    expect(courseFromSearch("?course=astrology")).toBeNull();
    expect(courseFromSearch("")).toBeNull();
  });
});

describe("the request it builds", () => {
  it("makes a student their own contact, with the consent version and no reference (no lead is made, S15.2)", () => {
    const body = buildOnboardingPayload(studentValues(), CONTEXT);
    expect(body).toMatchObject({ relationship: "student", applicant_name: "Ada Eze", contact_name: "Ada Eze", contact_country: "NG", contact_whatsapp: "+2348031234567", consent: { notice_version: CONSENT_NOTICE_VERSION } });
    expect(body).not.toHaveProperty("client_ref");
    expect(body).not.toHaveProperty("client_created_at");
  });

  it("keeps a parent's own name and number apart from the child's", () => {
    expect(buildOnboardingPayload(parentValues(), CONTEXT)).toMatchObject({ applicant_name: "Chidi Eze", applicant_country: "NG", contact_name: "Ngozi Eze", contact_country: "CM", contact_whatsapp: "+237671234567" });
  });

  it("drops blank grade rows and trims the rest", () => {
    const body = buildOnboardingPayload(studentValues({ results: [{ subject: " Physics ", grade: " B " }, { subject: "", grade: "" }] }), CONTEXT);
    expect(body.results).toEqual([{ subject: "Physics", grade: "B" }]);
  });

  it("passes the server's schema, for a student and for a parent", () => {
    for (const values of [studentValues(), parentValues()]) {
      const result = onboardingBodySchema.safeParse(buildOnboardingPayload(values, CONTEXT));
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  it("is refused by the server's schema exactly where the phone refuses it (one set of rules)", () => {
    const cases: Partial<OnboardingValues>[] = [
      { applicant_name: "" },
      { applicant_country: "FR" },
      { contact_whatsapp: "12" },
      { qualification_type: "" },
      { results: [{ subject: "Physics", grade: "" }] },
      { level: "doctorate" },
      { course_fields: ["law", "law"] },
      { course_fields: [] },
      { intake_year: 1990 },
    ];
    for (const over of cases) {
      const values = studentValues(over);
      const phone = validateAnswers(effectiveAnswers(values));
      const server = onboardingBodySchema.safeParse(buildOnboardingPayload(values, CONTEXT));
      const serverFields = server.success ? {} : fieldErrors(server.error.issues);
      expect(Object.keys(phone).length, JSON.stringify(over)).toBeGreaterThan(0);
      for (const [field, token] of Object.entries(phone)) expect(serverFields[field], `${JSON.stringify(over)} ${field}`).toBe(token);
    }
  });

  it("refuses unknown fields, and still accepts the reference and time an earlier version sent (a request queued on a phone)", () => {
    const body = buildOnboardingPayload(studentValues(), CONTEXT);
    expect(onboardingBodySchema.safeParse({ ...body, role: "owner" }).success).toBe(false);
    expect(onboardingBodySchema.safeParse({ ...body, client_ref: "nope" }).success).toBe(false);
    expect(onboardingBodySchema.safeParse({ ...body, client_ref: "SC-ABCDE-FGHJK", client_created_at: "2026-11-02T10:00:00.000Z" }).success).toBe(true);
  });
});

describe("POST me/onboarding: the server decision (21.6, 23.2)", () => {
  const NOW = new Date("2026-11-04T10:00:00Z");

  function setup(outcome: ProfileOutcome | Error) {
    const rows: NewProfile[] = [];
    const deps: CompleteOnboardingDeps = {
      insert: vi.fn(async (row) => {
        rows.push(row);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }),
      now: () => NOW,
      onError: vi.fn(),
    };
    return { deps, rows };
  }
  const body = (values = studentValues()) => buildOnboardingPayload(values, CONTEXT);

  it("stores the profile once, with the consent time set by the server clock, and makes no lead", async () => {
    const { deps, rows } = setup("created");
    const result = await completeOnboarding(deps, { body: body() });
    expect(result).toEqual({ ok: true, status: 201, replayed: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ada Eze", whatsappE164: "+2348031234567", countryCode: "NG", relationship: "student", level: "undergraduate", intakeYear: 2027, consentAt: NOW });
    // Nothing of a lead reaches the database call: no reference, no key, no response clock.
    expect(Object.keys(rows[0] as object)).not.toEqual(expect.arrayContaining(["refs", "idempotencyKey", "slaDueAt"]));
  });

  it("keeps the child's name and country in the profile and the parent's own name and number apart", async () => {
    const { deps, rows } = setup("created");
    await completeOnboarding(deps, { body: body(parentValues()) });
    expect(rows[0]).toMatchObject({ name: "Chidi Eze", countryCode: "NG", whatsappE164: "+237671234567", relationship: "parent", contactName: "Ngozi Eze" });
  });

  it("accepts the reference and time an earlier version sent, and ignores them", async () => {
    const { deps, rows } = setup("created");
    const result = await completeOnboarding(deps, { body: { ...body(), client_ref: "SC-ABCDE-FGHJK", client_created_at: "2026-11-02T10:00:00.000Z" } });
    expect(result).toMatchObject({ ok: true, status: 201 });
    expect(rows[0]).not.toHaveProperty("clientRef");
  });

  it("tells a second device or a retry to carry on with 200, and writes nothing", async () => {
    const { deps } = setup("already_onboarded");
    expect(await completeOnboarding(deps, { body: body() })).toEqual({ ok: true, status: 200, replayed: true });
  });

  it("refuses an account that may not onboard", async () => {
    const { deps } = setup("not_allowed");
    expect(await completeOnboarding(deps, { body: body() })).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
  });

  it("answers with ref null (no lead), so the phone's queue counts it as done", () => {
    const response = toResponse({ ok: true, status: 201, replayed: false }, "req");
    expect(response.status).toBe(201);
    return response.json().then((json) => expect(json).toEqual({ status: "created", ref: null }));
  });

  it("asks the phone to retry when the database fails, and logs the fault without leaking it", async () => {
    const { deps } = setup(new Error("connection refused: host=db.internal password=secret"));
    const result = await completeOnboarding(deps, { body: body() });
    expect(result).toEqual({ ok: false, status: 503, code: "TEMPORARILY_UNAVAILABLE", message: "Please try again shortly." });
    expect(deps.onError).toHaveBeenCalledOnce();
  });

  it("refuses bad answers before touching the database", async () => {
    const { deps } = setup("created");
    const bad = await completeOnboarding(deps, { body: { ...body(), level: "doctorate", contact_whatsapp: "1" } });
    expect(bad).toMatchObject({ ok: false, status: 400, code: "VALIDATION", fields: { level: "UNKNOWN_VALUE", contact_whatsapp: "PHONE_INVALID" } });
    expect(await completeOnboarding(deps, { body: "not an object" })).toMatchObject({ ok: false, status: 400 });
    expect(deps.insert).not.toHaveBeenCalled();
  });
});

describe("a finished questionnaire in the offline queue (21.6, step 5)", () => {
  const T0 = 1_800_000_000_000;
  const item = (over: Partial<QueuedLead> = {}): QueuedLead => ({
    kind: "onboarding",
    key: "33333333-3333-4333-8333-333333333333",
    payload: { relationship: "student" },
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
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "onboarding" }), "");
    expect(store.size).toBe(0);
  });

  it("still asks for a token for an ordinary lead in the same queue", async () => {
    const send = vi.fn(async (): Promise<Awaited<ReturnType<SyncDeps["send"]>>> => ({ verdict: "sent", ref: "SC-ABCDE-FGHJK", replayed: false }));
    const { sync, getToken } = deps([item({ kind: "lead" }), item({ key: "44444444-4444-4444-8444-444444444444", createdAt: T0 + 1 })], send);
    await syncOnce(sync);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it("keeps the same key on every retry, and waits when the session has ended", async () => {
    const send = vi.fn(async (): Promise<Awaited<ReturnType<SyncDeps["send"]>>> => ({ verdict: "retry", status: 401, code: "UNAUTHENTICATED", retryAfterSeconds: null }));
    const { sync, store } = deps([item()], send);
    await syncOnce(sync);
    expect(store.get("33333333-3333-4333-8333-333333333333")).toMatchObject({ status: "pending", lastError: "UNAUTHENTICATED", attempts: 1 });
  });

  describe("sending", () => {
    it("posts to the onboarding endpoint with the key in the header and no Turnstile token", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "created", ref: "SC-ABCDE-FGHJK" }), { status: 201 }));
      const result = await sendLead({ kind: "onboarding", key: "k-1", payload: { relationship: "student" } }, "", fetchMock as unknown as typeof fetch);
      expect(result).toEqual({ verdict: "sent", ref: "SC-ABCDE-FGHJK", replayed: false });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/v1/me/onboarding");
      expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
      expect(JSON.parse(String(init.body))).toEqual({ relationship: "student" });
    });

    it("counts a 200 with no reference as done (another device finished first)", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "replayed", ref: null }), { status: 200 }));
      expect(await sendLead({ kind: "onboarding", key: "k-2", payload: {} }, "", fetchMock as unknown as typeof fetch)).toEqual({ verdict: "sent", ref: "", replayed: true });
    });

    it("still sends an ordinary lead to the leads endpoint with its Turnstile token", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "created", ref: "SC-ABCDE-FGHJK" }), { status: 201 }));
      await sendLead({ key: "k-3", payload: { name: "x" } }, "tok", fetchMock as unknown as typeof fetch);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/v1/leads");
      expect(JSON.parse(String(init.body))).toEqual({ name: "x", turnstile_token: "tok" });
    });

    it("treats an ended session (401) as a reason to wait, not to give up", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }), { status: 401 }));
      expect(await sendLead({ kind: "onboarding", key: "k-4", payload: {} }, "", fetchMock as unknown as typeof fetch)).toMatchObject({ verdict: "retry", status: 401, code: "UNAUTHENTICATED" });
    });
  });
});

describe("the words", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value !== null && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];

  it("has the same onboarding strings in English and French", () => {
    expect(keys(fr.onboarding).sort()).toEqual(keys(en.onboarding).sort());
  });

  it("has a title for every screen, a translation for every error the rules can produce, and every course name", () => {
    for (const step of new Set([...STEPS_FOR.student, ...STEPS_FOR.parent])) expect(en.onboarding[step].title, step).toBeTruthy();
    for (const token of ["REQUIRED", "TOO_LONG", "INVALID", "UNKNOWN_VALUE", "DUPLICATE", "PHONE_INVALID", "CONSENT_REQUIRED"]) {
      expect((en.onboarding.errors as Record<string, string>)[token], token).toBeTruthy();
      expect((fr.onboarding.errors as Record<string, string>)[token], token).toBeTruthy();
    }
    for (const code of COURSE_FIELDS) expect((en.courses as Record<string, string>)[code], code).toBeTruthy();
  });

  it("documents the {contact_name} placeholder for the admin's WhatsApp templates", () => {
    expect(JSON.stringify(en)).toContain("{contact_name}");
    expect(JSON.stringify(fr)).toContain("{contact_name}");
  });
});
