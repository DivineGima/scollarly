import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountMutations } from "@/modules/account/endpoints";
import { onboardingDataCalls, onboardingMutations } from "@/modules/onboarding/endpoints";
import { buildOnboardingPayload, emptyValues, type OnboardingValues } from "@/modules/onboarding/payload";
import { mintActor } from "@/server/auth/actor";
import { createAuthFacade } from "@/server/auth/facade";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleMutation } from "@/server/edge/mutations";
import { listDuplicatePairs } from "@/server/repositories/lead-admin";
import { resolveSession } from "@/server/repositories/identity";
import { eraseMyAccount, exportMyData } from "@/server/repositories/student";
import { createTestDb, type SignedInUser, type TestDb } from "./helpers/db";
import { leadRow, q } from "./helpers/fixtures";

/**
 * S13.3 (architecture 21.6, ADR-043), against a real database as the runtime role: finishing onboarding makes exactly one lead and one
 * profile, whatever is retried, whichever device sends it, and whatever order the requests arrive in.
 */

const ORIGIN = "https://scollarly.test";
let t: TestDb;
let env: EndpointEnv;
let facade: ReturnType<typeof createAuthFacade>;

beforeAll(async () => {
  t = await createTestDb();
  env = { db: t.db, ownerEmail: "someone.else@example.test", totpKey: Buffer.from(randomBytes(32)).toString("base64"), now: () => new Date(), };
  facade = createAuthFacade((token) => resolveSession(t.db, token));
});
afterAll(async () => {
  await t.close();
});

const cookieOf = (user: SignedInUser) => `__Secure-neon-auth.session_token=${user.token}.sig`;

/** A signed-in account with the given role; confirmed unless said otherwise. */
async function account(role: "student" | "admin" | "owner" = "student", confirmed = true): Promise<SignedInUser> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(user.userId)}, ${q(role)}, ${confirmed ? "now()" : "null"}) on conflict (id) do update set role = excluded.role, account_confirmed_at = excluded.account_confirmed_at`);
  return user;
}

const mutations = { ...accountMutations, ...onboardingMutations };

async function post(user: SignedInUser, body: unknown, key: string = randomUUID()): Promise<Response> {
  await t.asRuntime();
  try {
    const request = new Request(`${ORIGIN}/api/v1/me/onboarding`, {
      method: "POST",
      headers: { cookie: cookieOf(user), origin: ORIGIN, "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    });
    return (await handleMutation(request, () => ({ checkSession: facade.checkSession, mutations, env, limit: async () => ({ allowed: true, remaining: 100, retryAfterSeconds: 0 }) }))) as Response;
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
  results: [{ subject: "Mathematics", grade: "A" }],
  level: "undergraduate",
  course_fields: ["computer_science_it", "law"],
  intake_year: 2027,
  consent: true,
  ...over,
});

const parent = (over: Partial<OnboardingValues> = {}): OnboardingValues =>
  student({ relationship: "parent", applicant_name: "Chidi Eze", contact_name: "Ngozi Eze", contact_country: "CM", contact_whatsapp: `+2376${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, ...over });

const bodyOf = (values: OnboardingValues) => buildOnboardingPayload(values, { locale: "en" });

const count = async (sqlText: string) => ((await t.run(sqlText)) as { n: number }[])[0]?.n;
const leadsOf = (user: SignedInUser) => count(`select count(*)::int as n from lead where user_id = ${q(user.userId)}`);
const profilesOf = (user: SignedInUser) => count(`select count(*)::int as n from student_profile where user_id = ${q(user.userId)}`);

describe("finishing onboarding", () => {
  it("makes one lead, linked to the account, and one profile, with an audit row that holds ids only", async () => {
    const user = await account();
    const values = student();
    const response = await post(user, bodyOf(values));
    expect(response.status).toBe(201);
    const { ref } = (await response.json()) as { ref: string };

    const [lead] = (await t.run(`select ref, intake_kind, name, whatsapp_e164, country_code, qualification_type, user_id, stage_code, source, results from lead where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(lead).toMatchObject({ ref, intake_kind: "onboarding", name: "Ada Eze", country_code: "NG", qualification_type: "olevel_alevel", user_id: user.userId, stage_code: "share_results" });
    expect(lead?.whatsapp_e164).toBe(values.contact_whatsapp);
    expect(lead?.source).toMatchObject({ page: "onboarding", relationship: "student", contact_name: "Ada Eze", course_fields: ["computer_science_it", "law"], level: "undergraduate", intake_year: 2027 });

    const [profile] = (await t.run(`select relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164, level, course_fields, intake_year, consent_notice_version, lead_id from student_profile where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(profile).toMatchObject({ relationship: "student", applicant_name: "Ada Eze", applicant_country: "NG", contact_name: "Ada Eze", level: "undergraduate", course_fields: ["computer_science_it", "law"], intake_year: 2027 });

    const activity = (await t.run(`select type from lead_activity where lead_id = (select id from lead where user_id = ${q(user.userId)}) order by type`)) as { type: string }[];
    expect(activity.map((a) => a.type)).toEqual(["claimed", "created"]);
    expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(user.userId)} and method = 'auto' and status = 'approved'`)).toBe(1);

    const audit = (await t.run(`select actor_id, meta from audit_log where action = 'onboarding.completed' and actor_id = ${q(user.userId)}`)) as { actor_id: string; meta: Record<string, unknown> }[];
    expect(audit).toHaveLength(1);
    expect(Object.keys(audit[0]?.meta ?? {}).sort()).toEqual(["lead_id", "relationship"]);
    expect(JSON.stringify(audit)).not.toContain("Ada");
    expect(JSON.stringify(audit)).not.toContain(values.contact_whatsapp);
  });

  it("answers the same request again with the same lead and writes nothing more (an offline retry, a double tap)", async () => {
    const user = await account();
    const body = bodyOf(student());
    const key = randomUUID();
    const first = await post(user, body, key);
    const again = await post(user, body, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { ref: string; status: string })).toMatchObject({ status: "replayed", ref: ((await first.json()) as { ref: string }).ref });
    expect(await leadsOf(user)).toBe(1);
    expect(await profilesOf(user)).toBe(1);
    expect(await count(`select count(*)::int as n from audit_log where action = 'onboarding.completed' and actor_id = ${q(user.userId)}`)).toBe(1);
  });

  it("lets a second device carry on: another key from the same account creates nothing", async () => {
    const user = await account();
    expect((await post(user, bodyOf(student()))).status).toBe(201);
    const other = await post(user, bodyOf(student({ applicant_name: "Different Name" })));
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ status: "replayed", ref: null });
    expect(await leadsOf(user)).toBe(1);
    expect(await profilesOf(user)).toBe(1);
    expect(((await t.run(`select applicant_name from student_profile where user_id = ${q(user.userId)}`)) as { applicant_name: string }[])[0]?.applicant_name).toBe("Ada Eze");
  });

  it("refuses the same key with different answers", async () => {
    const user = await account();
    const key = randomUUID();
    expect((await post(user, bodyOf(student()), key)).status).toBe(201);
    const different = await post(user, bodyOf(student({ level: "postgraduate" })), key);
    expect(different.status).toBe(409);
    expect(await leadsOf(user)).toBe(1);
  });
});

describe("a parent applying for a child", () => {
  it("gives the lead the child's name and the parent's number, and the profile the relationship", async () => {
    const user = await account();
    const values = parent();
    expect((await post(user, bodyOf(values))).status).toBe(201);
    const [lead] = (await t.run(`select name, whatsapp_e164, country_code, source from lead where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(lead).toMatchObject({ name: "Chidi Eze", whatsapp_e164: values.contact_whatsapp, country_code: "NG" });
    expect(lead?.source).toMatchObject({ relationship: "parent", contact_name: "Ngozi Eze" });
    expect(values.contact_whatsapp.startsWith("+237")).toBe(true);
    const [profile] = (await t.run(`select relationship, applicant_name, contact_name, contact_whatsapp_e164 from student_profile where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(profile).toMatchObject({ relationship: "parent", applicant_name: "Chidi Eze", contact_name: "Ngozi Eze", contact_whatsapp_e164: values.contact_whatsapp });
  });
});

describe("who may finish onboarding", () => {
  it("refuses an account that has not been confirmed", async () => {
    const user = await account("student", false);
    const response = await post(user, bodyOf(student()));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("ACCOUNT_NOT_CONFIRMED");
    expect(await profilesOf(user)).toBe(0);
  });

  it("refuses a signed-out caller", async () => {
    const stranger = await t.signIn({ verified: false });
    expect((await post(stranger, bodyOf(student()))).status).toBe(401);
  });

  it("refuses a staff account: only a student-role account has an onboarding", async () => {
    for (const role of ["admin", "owner"] as const) {
      const user = await account(role);
      const response = await post(user, bodyOf(student()));
      expect(response.status, role).toBe(403);
      expect(await leadsOf(user)).toBe(0);
      expect(await profilesOf(user)).toBe(0);
    }
  });

  it("never answers with another person's lead when a key collides", async () => {
    const owner = await account();
    const key = randomUUID();
    const made = await post(owner, bodyOf(student()), key);
    const { ref } = (await made.json()) as { ref: string };

    const intruder = await account();
    const response = await post(intruder, bodyOf(student()), key);
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain(ref);
    expect(await profilesOf(intruder)).toBe(0);
  });

  it("never lets the body name the account: the profile belongs to the session", async () => {
    const victim = await account();
    const user = await account();
    const response = await post(user, { ...bodyOf(student()), user_id: victim.userId });
    expect(response.status).toBe(400);
    expect(await profilesOf(victim)).toBe(0);
  });
});

describe("what the database refuses", () => {
  it("refuses invalid answers before anything is written", async () => {
    const user = await account();
    const response = await post(user, { ...bodyOf(student()), level: "doctorate", course_fields: [] });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { fields: Record<string, string> } }).error.fields).toMatchObject({ level: "UNKNOWN_VALUE", course_fields: "REQUIRED" });
    expect(await leadsOf(user)).toBe(0);
  });

  it("applies the same five-leads-a-day limit per number as every other lead", async () => {
    const number = "+2348099999999";
    for (let i = 0; i < 5; i += 1) await leadRow(t, { whatsapp_e164: number });
    const user = await account();
    const response = await post(user, bodyOf(student({ contact_whatsapp: number })));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(await leadsOf(user)).toBe(0);
    expect(await profilesOf(user)).toBe(0);
  });
});

describe("a number that already has a lead", () => {
  it("still creates the lead, and shows both to admins as a duplicate, never merged", async () => {
    const number = "+2348077771111";
    const earlier = await leadRow(t, { whatsapp_e164: number, name: "Ada From Apply" });
    const user = await account();
    expect((await post(user, bodyOf(student({ contact_whatsapp: number })))).status).toBe(201);
    const mine = ((await t.run(`select id from lead where user_id = ${q(user.userId)}`)) as { id: string }[])[0]?.id ?? "";

    await t.asRuntime();
    try {
      const admin = mintActor({ userId: "admin-1", sessionId: "s-admin", storedRole: "admin", role: "admin", twoFactorVerifiedAt: null });
      const pairs = await listDuplicatePairs(t.db, admin, { leadId: mine });
      expect(pairs).toHaveLength(1);
      expect([pairs[0]?.a.id, pairs[0]?.b.id].sort()).toEqual([earlier, mine].sort());
    } finally {
      await t.asOwner();
    }
    expect(await count(`select count(*)::int as n from lead where whatsapp_e164 = ${q(number)} and merged_into_id is null`)).toBe(2);
  });
});

describe("the state of onboarding", () => {
  it("reads only the caller's own: not finished, then finished with the reference", async () => {
    const user = await account();
    const other = await account();
    const state = async (who: SignedInUser) => {
      await t.asRuntime();
      try {
        const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(who) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
        return (await onboardingDataCalls(env)["me/onboarding-state"]?.(actor, { token: who.token, url: new URL(`${ORIGIN}/api/v1/me/onboarding-state`) })) as { userId: string; onboarded: boolean; relationship: string | null; ref: string | null };
      } finally {
        await t.asOwner();
      }
    };
    expect(await state(user)).toEqual({ userId: user.userId, onboarded: false, relationship: null, ref: null });
    const made = await post(user, bodyOf(parent()));
    const { ref } = (await made.json()) as { ref: string };
    expect(await state(user)).toEqual({ userId: user.userId, onboarded: true, relationship: "parent", ref });
    expect(await state(other)).toMatchObject({ onboarded: false, ref: null });
  });
});

describe("the account's data", () => {
  it("is in the student's own export, and goes with the account when it is erased", async () => {
    const user = await account();
    const values = parent();
    expect((await post(user, bodyOf(values))).status).toBe(201);
    const leadId = ((await t.run(`select id from lead where user_id = ${q(user.userId)}`)) as { id: string }[])[0]?.id ?? "";

    await t.asRuntime();
    try {
      const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(user) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
      const exported = await exportMyData(t.db, actor);
      expect(exported.leads).toHaveLength(1);
      expect(exported.leads[0]).toMatchObject({ intakeKind: "onboarding", name: "Chidi Eze", whatsapp: values.contact_whatsapp });
      expect(exported.profile).toMatchObject({ relationship: "parent", applicantName: "Chidi Eze", contactName: "Ngozi Eze", contactWhatsapp: values.contact_whatsapp, level: "undergraduate", courseFields: ["computer_science_it", "law"], intakeYear: 2027 });

      expect(await eraseMyAccount(t.db, actor, user.token)).toBe("erased");
    } finally {
      await t.asOwner();
    }
    expect(await profilesOf(user)).toBe(0);
    // The lead the onboarding made is anonymised by the existing erasure path: the row stays for the counts, the person's details go.
    const [lead] = (await t.run(`select name, whatsapp_e164, anonymised_at from lead where id = ${q(leadId)}`)) as Record<string, unknown>[];
    expect(lead?.anonymised_at).not.toBeNull();
    expect(lead?.name).toBeNull();
    expect(lead?.whatsapp_e164).toBeNull();
  });

  it("is empty in the export of someone who has not finished", async () => {
    const user = await account();
    await t.asRuntime();
    try {
      const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(user) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
      expect((await exportMyData(t.db, actor)).profile).toBeNull();
    } finally {
      await t.asOwner();
    }
  });
});
