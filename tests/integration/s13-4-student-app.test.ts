import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onboardingMutations } from "@/modules/onboarding/endpoints";
import { buildOnboardingPayload, emptyValues, type OnboardingValues } from "@/modules/onboarding/payload";
import { studentDataCalls } from "@/modules/student/endpoints";
import { createAuthFacade } from "@/server/auth/facade";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleMutation } from "@/server/edge/mutations";
import { resolveSession } from "@/server/repositories/identity";
import { createTestDb, type SignedInUser, type TestDb } from "./helpers/db";
import { q } from "./helpers/fixtures";

/**
 * S13.4 (architecture 21.4): `me/home` and `me/preferences` return only the caller's own data, as the runtime role, so row level security
 * is the second lock. A person's answers come from their own profile; another person's never appear.
 */

const ORIGIN = "https://scollarly.test";
let t: TestDb;
let env: EndpointEnv;
let facade: ReturnType<typeof createAuthFacade>;

beforeAll(async () => {
  t = await createTestDb();
  env = { db: t.db, ownerEmail: "someone.else@example.test", totpKey: Buffer.from(randomBytes(32)).toString("base64"), now: () => new Date() };
  facade = createAuthFacade((token) => resolveSession(t.db, token));
});
afterAll(async () => {
  await t.close();
});

const cookieOf = (user: SignedInUser) => `__Secure-neon-auth.session_token=${user.token}.sig`;

async function account(role: "student" | "admin" | "owner" = "student"): Promise<SignedInUser> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(user.userId)}, ${q(role)}, now()) on conflict (id) do update set role = excluded.role, account_confirmed_at = excluded.account_confirmed_at`);
  return user;
}

async function onboard(user: SignedInUser, values: OnboardingValues): Promise<void> {
  await t.asRuntime();
  try {
    const request = new Request(`${ORIGIN}/api/v1/me/onboarding`, {
      method: "POST",
      headers: { cookie: cookieOf(user), origin: ORIGIN, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify(buildOnboardingPayload(values, { locale: "en" })),
    });
    const response = (await handleMutation(request, () => ({ checkSession: facade.checkSession, mutations: onboardingMutations, env, limit: async () => ({ allowed: true, remaining: 100, retryAfterSeconds: 0 }) }))) as Response;
    expect(response.status).toBe(201);
  } finally {
    await t.asOwner();
  }
}

type Call = "me/home" | "me/preferences";
async function call(user: SignedInUser, name: Call): Promise<Record<string, unknown>> {
  await t.asRuntime();
  try {
    const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(user) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
    const handler = studentDataCalls(env)[name];
    return (await handler?.(actor, { token: user.token, url: new URL(`${ORIGIN}/api/v1/${name}`) })) as Record<string, unknown>;
  } finally {
    await t.asOwner();
  }
}

const student = (over: Partial<OnboardingValues> = {}): OnboardingValues => ({
  ...emptyValues("student"),
  applicant_name: "Ada Eze",
  applicant_country: "NG",
  contact_whatsapp: `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
  qualification_type: "olevel_alevel",
  level: "undergraduate",
  course_fields: ["computer_science_it", "law"],
  intake_year: 2027,
  consent: true,
  ...over,
});

describe("me/preferences", () => {
  it("says a person who has not finished has no answers, and greets them by the name Google gave", async () => {
    const user = await account();
    expect(await call(user, "me/preferences")).toEqual({ userId: user.userId, onboarded: false, firstName: null, courseFields: [], level: null, intakeYear: null });
    const home = await call(user, "me/home");
    expect(home).toMatchObject({ userId: user.userId, onboarded: false, firstName: "Test", courseFields: [], lead: null });
  });

  it("returns the student's own answers and first name only", async () => {
    const user = await account();
    await onboard(user, student({ applicant_name: "Ada Eze" }));
    const preferences = await call(user, "me/preferences");
    expect(preferences).toEqual({ userId: user.userId, onboarded: true, firstName: "Ada", courseFields: ["computer_science_it", "law"], level: "undergraduate", intakeYear: 2027 });
    expect(JSON.stringify(preferences)).not.toContain("Eze");
  });

  it("greets a parent by their own name, not the child's", async () => {
    const user = await account();
    await onboard(user, student({ relationship: "parent", applicant_name: "Chidi Eze", contact_name: "Ngozi Eze", contact_country: "CM", contact_whatsapp: "+237671234567", course_fields: ["law"] }));
    expect(await call(user, "me/preferences")).toMatchObject({ firstName: "Ngozi", courseFields: ["law"] });
  });

  it("never shows one student's answers to another", async () => {
    const first = await account();
    const second = await account();
    await onboard(first, student({ course_fields: ["pharmacy"] }));
    await onboard(second, student({ applicant_name: "Kofi Mensah", course_fields: ["civil_engineering"] }));
    expect(await call(first, "me/preferences")).toMatchObject({ firstName: "Ada", courseFields: ["pharmacy"] });
    expect(await call(second, "me/preferences")).toMatchObject({ firstName: "Kofi", courseFields: ["civil_engineering"] });
    const other = await account();
    expect(await call(other, "me/preferences")).toMatchObject({ onboarded: false, courseFields: [] });
  });
});

describe("me/home", () => {
  it("returns the caller's own lead and stage with the answers, and the order of the six stages", async () => {
    const user = await account();
    await onboard(user, student());
    const home = (await call(user, "me/home")) as { lead: { ref: string; stage: string; updatedAt: string } | null; stages: { code: string; position: number }[]; firstName: string; courseFields: string[]; whatsappE164: string | null };
    expect(home.firstName).toBe("Ada");
    expect(home.courseFields).toEqual(["computer_science_it", "law"]);
    expect(home.lead?.stage).toBe("share_results");
    expect(home.lead?.ref).toMatch(/^SC-/);
    expect(home.stages.map((s) => s.code)).toEqual(["share_results", "choose_course", "offer_letter", "confirm_admission", "visa", "arrived"]);
  });

  it("does not return another student's lead or reference", async () => {
    const first = await account();
    const second = await account();
    await onboard(first, student());
    const secondHome = (await call(second, "me/home")) as { lead: unknown };
    expect(secondHome.lead).toBeNull();
    const firstRef = ((await call(first, "me/home")) as { lead: { ref: string } }).lead.ref;
    expect(JSON.stringify(await call(second, "me/home"))).not.toContain(firstRef);
  });

  it("holds no number, no email and no full name", async () => {
    const user = await account();
    const values = student({ applicant_name: "Ada Okonkwo Eze" });
    await onboard(user, values);
    const text = JSON.stringify(await call(user, "me/home"));
    expect(text).not.toContain(values.contact_whatsapp);
    expect(text).not.toContain("@");
    expect(text).not.toContain("Okonkwo");
  });
});
