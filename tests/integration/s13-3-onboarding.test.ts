import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountMutations } from "@/modules/account/endpoints";
import { onboardingDataCalls, onboardingMutations } from "@/modules/onboarding/endpoints";
import { buildOnboardingPayload, emptyValues, type OnboardingValues } from "@/modules/onboarding/payload";
import { mintActor } from "@/server/auth/actor";
import { createAuthFacade } from "@/server/auth/facade";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleMutation } from "@/server/edge/mutations";
import { resolveSession } from "@/server/repositories/identity";
import { listDuplicatePairs } from "@/server/repositories/lead-admin";
import { eraseMyAccount, exportMyData } from "@/server/repositories/student";
import type { Db } from "@/server/db/client";
import { createTestDb, openRuntimeConnections, type SignedInUser, type TestDb } from "./helpers/db";
import { leadRow, q } from "./helpers/fixtures";

/**
 * S13.3 changed by S15.2 (architecture 21.6, 23.2, ADR-043, ADR-062), against a real database as the runtime role: finishing onboarding
 * stores exactly one profile and makes NO lead, whatever is retried, whichever device sends it, and whatever order the requests arrive in.
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

/** A signed-in account with the given role; confirmed unless said otherwise. */
async function account(role: "student" | "manager" | "admin" = "student", confirmed = true): Promise<SignedInUser> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(user.userId)}, ${q(role)}, ${confirmed ? "now()" : "null"}) on conflict (id) do update set role = excluded.role, account_confirmed_at = excluded.account_confirmed_at`);
  return user;
}

const mutations = { ...accountMutations, ...onboardingMutations };

async function post(user: SignedInUser, body: unknown): Promise<Response> {
  await t.asRuntime();
  try {
    const request = new Request(`${ORIGIN}/api/v1/me/onboarding`, {
      method: "POST",
      headers: { cookie: cookieOf(user), origin: ORIGIN, "content-type": "application/json", "idempotency-key": randomUUID() },
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
  it("stores one profile and no lead, records that the student is done, and writes an audit row that holds codes only", async () => {
    const user = await account();
    const doneAt = async () => ((await t.run(`select onboarding_done_at from app_user where id = ${q(user.userId)}`)) as { onboarding_done_at: unknown }[])[0]?.onboarding_done_at;
    expect(await doneAt()).toBeNull(); // the student area is closed to them until now (S14.5, ADR-053)
    const values = student();
    const response = await post(user, bodyOf(values));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "created", ref: null });
    expect(await doneAt()).not.toBeNull(); // recorded by the profile row, so a profile without a lead counts as done

    expect(await leadsOf(user)).toBe(0);
    expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(user.userId)}`)).toBe(0);

    const [profile] = (await t.run(`select relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164, level, course_fields, intake_year, consent_notice_version, lead_id from student_profile where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(profile).toMatchObject({ relationship: "student", applicant_name: "Ada Eze", applicant_country: "NG", contact_name: "Ada Eze", contact_whatsapp_e164: values.contact_whatsapp, level: "undergraduate", course_fields: ["computer_science_it", "law"], intake_year: 2027, lead_id: null });

    const audit = (await t.run(`select actor_id, meta from audit_log where action = 'onboarding.completed' and actor_id = ${q(user.userId)}`)) as { actor_id: string; meta: Record<string, unknown> }[];
    expect(audit).toHaveLength(1);
    expect(Object.keys(audit[0]?.meta ?? {}).sort()).toEqual(["relationship"]);
    expect(JSON.stringify(audit)).not.toContain("Ada");
    expect(JSON.stringify(audit)).not.toContain(values.contact_whatsapp);
  });

  it("answers the same request again with 200 and writes nothing more (an offline retry, a double tap)", async () => {
    const user = await account();
    const body = bodyOf(student());
    const first = await post(user, body);
    const again = await post(user, body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "replayed", ref: null });
    expect(await leadsOf(user)).toBe(0);
    expect(await profilesOf(user)).toBe(1);
    expect(await count(`select count(*)::int as n from audit_log where action = 'onboarding.completed' and actor_id = ${q(user.userId)}`)).toBe(1);
  });

  it("lets a second device carry on: other answers from the same account change nothing", async () => {
    const user = await account();
    expect((await post(user, bodyOf(student()))).status).toBe(201);
    const other = await post(user, bodyOf(student({ applicant_name: "Different Name" })));
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ status: "replayed", ref: null });
    expect(await profilesOf(user)).toBe(1);
    expect(((await t.run(`select applicant_name from student_profile where user_id = ${q(user.userId)}`)) as { applicant_name: string }[])[0]?.applicant_name).toBe("Ada Eze");
  });

  // The account's primary key is the guard. Two requests only overlap on two database sessions, so this needs a real Postgres with two
  // connections (the CI service container); the in-process engine has one connection.
  it.skipIf(!process.env.TEST_DATABASE_URL)("two requests at the same moment still make one profile (two connections)", async () => {
    const user = await account();
    const payload = bodyOf(student());
    const extra = await openRuntimeConnections(2);
    try {
      const call = (db: Db) =>
        handleMutation(
          new Request(`${ORIGIN}/api/v1/me/onboarding`, {
            method: "POST",
            headers: { cookie: cookieOf(user), origin: ORIGIN, "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
          () => ({ checkSession: facade.checkSession, mutations, env: { ...env, db }, limit: async () => ({ allowed: true, remaining: 100, retryAfterSeconds: 0 }) }),
        ) as Promise<Response>;
      const [a, b] = await Promise.all(extra.dbs.map((db) => call(db)));
      expect([a?.status, b?.status].sort()).toEqual([200, 201]);
    } finally {
      await extra.close();
    }
    expect(await profilesOf(user)).toBe(1);
  });

  it("still accepts the reference and time an earlier version sent, and ignores them", async () => {
    const user = await account();
    const response = await post(user, { ...bodyOf(student()), client_ref: "SC-ABCDE-FGHJK", client_created_at: new Date().toISOString() });
    expect(response.status).toBe(201);
    expect(await leadsOf(user)).toBe(0);
  });
});

describe("a parent onboarding for a child", () => {
  it("keeps the child's name and country in the profile, with the parent's own name and number, and the relationship", async () => {
    const user = await account();
    const values = parent();
    expect((await post(user, bodyOf(values))).status).toBe(201);
    expect(values.contact_whatsapp.startsWith("+237")).toBe(true);
    const [profile] = (await t.run(`select relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164 from student_profile where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(profile).toMatchObject({ relationship: "parent", applicant_name: "Chidi Eze", applicant_country: "NG", contact_name: "Ngozi Eze", contact_whatsapp_e164: values.contact_whatsapp });
    expect(await leadsOf(user)).toBe(0);
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
    // Signed out: a session that has ended (an unverified student is no longer signed out: email and password accounts are unverified, PRD_3 F21).
    const stranger = await t.signIn({ expiresInMs: -60_000 });
    expect((await post(stranger, bodyOf(student()))).status).toBe(401);
  });

  it("refuses a staff account: only a student-role account has an onboarding", async () => {
    for (const role of ["manager", "admin"] as const) {
      const user = await account(role);
      const response = await post(user, bodyOf(student()));
      expect(response.status, role).toBe(403);
      expect(await profilesOf(user)).toBe(0);
    }
  });

  it("never lets the body name the account: the profile belongs to the session", async () => {
    const victim = await account();
    const user = await account();
    const response = await post(user, { ...bodyOf(student()), user_id: victim.userId });
    expect(response.status).toBe(400);
    expect(await profilesOf(victim)).toBe(0);
    expect(await profilesOf(user)).toBe(0);
  });
});

describe("what the database refuses", () => {
  it("refuses invalid answers before anything is written", async () => {
    const user = await account();
    const response = await post(user, { ...bodyOf(student()), level: "doctorate", course_fields: [] });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { fields: Record<string, string> } }).error.fields).toMatchObject({ level: "UNKNOWN_VALUE", course_fields: "REQUIRED" });
    expect(await profilesOf(user)).toBe(0);
  });

  it("does not apply the five-leads-a-day number limit: that limit belongs to applying, not to onboarding", async () => {
    const number = "+2348099999999";
    for (let i = 0; i < 5; i += 1) await leadRow(t, { whatsapp_e164: number });
    const user = await account();
    const response = await post(user, bodyOf(student({ contact_whatsapp: number })));
    expect(response.status).toBe(201);
    expect(await profilesOf(user)).toBe(1);
    expect(await leadsOf(user)).toBe(0);
  });
});

describe("a number that already has a lead", () => {
  it("shows two leads from one number to admins as a duplicate, never merged", async () => {
    // Onboarding makes no lead now (S15.2); the rule for two leads from one number is the same for an application (S15.3) and for an older lead.
    const number = "+2348077771111";
    const earlier = await leadRow(t, { whatsapp_e164: number, name: "Ada From Apply" });
    const later = await leadRow(t, { whatsapp_e164: number, name: "Ada Again" });

    await t.asRuntime();
    try {
      const admin = mintActor({ userId: "admin-1", sessionId: "s-admin", storedRole: "admin", role: "admin", twoFactorVerifiedAt: null });
      const pairs = await listDuplicatePairs(t.db, admin, { leadId: later });
      expect(pairs).toHaveLength(1);
      expect([pairs[0]?.a.id, pairs[0]?.b.id].sort()).toEqual([earlier, later].sort());
    } finally {
      await t.asOwner();
    }
    expect(await count(`select count(*)::int as n from lead where whatsapp_e164 = ${q(number)} and merged_into_id is null`)).toBe(2);
  });
});

describe("the state of onboarding", () => {
  it("reads only the caller's own: not finished, then finished with no reference because nothing was applied for", async () => {
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
    expect((await post(user, bodyOf(parent()))).status).toBe(201);
    expect(await state(user)).toEqual({ userId: user.userId, onboarded: true, relationship: "parent", ref: null });
    expect(await state(other)).toMatchObject({ onboarded: false, ref: null });
  });
});

describe("the account's data", () => {
  it("is in the student's own export, and goes with the account when it is erased", async () => {
    const user = await account();
    const values = parent();
    expect((await post(user, bodyOf(values))).status).toBe(201);

    await t.asRuntime();
    try {
      const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(user) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
      const exported = await exportMyData(t.db, actor);
      expect(exported.leads).toHaveLength(0);
      expect(exported.profile).toMatchObject({ relationship: "parent", applicantName: "Chidi Eze", contactName: "Ngozi Eze", contactWhatsapp: values.contact_whatsapp, level: "undergraduate", courseFields: ["computer_science_it", "law"], intakeYear: 2027 });

      expect(await eraseMyAccount(t.db, actor, user.token)).toBe("erased");
    } finally {
      await t.asOwner();
    }
    expect(await profilesOf(user)).toBe(0);
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
