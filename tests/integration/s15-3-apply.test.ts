import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountMutations } from "@/modules/account/endpoints";
import { applicationDataCalls, applicationMutations } from "@/modules/applications/endpoints";
import { onboardingMutations } from "@/modules/onboarding/endpoints";
import { buildOnboardingPayload, emptyValues, type OnboardingValues } from "@/modules/onboarding/payload";
import { generateRef } from "@/lib/ref";
import { mintActor } from "@/server/auth/actor";
import { createAuthFacade } from "@/server/auth/facade";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleMutation } from "@/server/edge/mutations";
import { resolveSession } from "@/server/repositories/identity";
import { listDuplicatePairs } from "@/server/repositories/lead-admin";
import { tokenHasApplication } from "@/server/repositories/lead-intake";
import type { Db } from "@/server/db/client";
import { createTestDb, openRuntimeConnections, type SignedInUser, type TestDb } from "./helpers/db";
import { leadRow, programmeRow, q, uni } from "./helpers/fixtures";

/**
 * S15.3 (PRD_4 F24, FR-34; architecture 23.2, 23.3, ADR-059), against a real database as the runtime role: the application is made from the
 * profile, once per account, whatever is retried, whichever device sends it, and in whatever order the requests arrive.
 */

const ORIGIN = "https://scollarly.test";
let t: TestDb;
let env: EndpointEnv;
let facade: ReturnType<typeof createAuthFacade>;
let programmes: string[] = [];

beforeAll(async () => {
  t = await createTestDb();
  env = { db: t.db, ownerEmail: "someone.else@example.test", totpKey: Buffer.from(randomBytes(32)).toString("base64"), now: () => new Date() };
  facade = createAuthFacade((token) => resolveSession(t.db, token));
  const university = await uni(t);
  programmes = [];
  for (let i = 0; i < 4; i += 1) programmes.push(await programmeRow(t, university, { name: `Programme ${i + 1}` }));
});
afterAll(async () => {
  await t.close();
});

const cookieOf = (user: SignedInUser) => `__Secure-neon-auth.session_token=${user.token}.sig`;
const mutations = { ...accountMutations, ...onboardingMutations, ...applicationMutations };

/** A signed-in account with the given role; confirmed, and (for a student) not yet onboarded unless said otherwise. */
async function account(role: "student" | "admin" | "owner" = "student", confirmed = true): Promise<SignedInUser> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(user.userId)}, ${q(role)}, ${confirmed ? "now()" : "null"}) on conflict (id) do update set role = excluded.role, account_confirmed_at = excluded.account_confirmed_at`);
  return user;
}

async function send(user: SignedInUser, path: string, body: unknown, key: string = randomUUID()): Promise<Response> {
  await t.asRuntime();
  try {
    const request = new Request(`${ORIGIN}${path}`, {
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

/** A student who has finished onboarding (a profile, no lead). */
async function onboarded(values: OnboardingValues = student()): Promise<{ user: SignedInUser; values: OnboardingValues }> {
  const user = await account();
  const response = await send(user, "/api/v1/me/onboarding", buildOnboardingPayload(values, { locale: "en" }));
  expect(response.status).toBe(201);
  return { user, values };
}

const body = (ids: string[] = programmes.slice(0, 3), over: Record<string, unknown> = {}) => ({
  programme_ids: ids,
  locale: "en",
  client_ref: generateRef(),
  client_created_at: new Date().toISOString(),
  ...over,
});
const apply = (user: SignedInUser, payload: unknown = body(), key?: string) => send(user, "/api/v1/me/application", payload, key);

const count = async (sqlText: string) => ((await t.run(sqlText)) as { n: number }[])[0]?.n;
const leadsOf = (user: SignedInUser) => count(`select count(*)::int as n from lead where user_id = ${q(user.userId)}`);
const errorOf = async (response: Response) => (await response.json()) as { error: { code: string; message: string; fields?: Record<string, string> } };

describe("applying from the profile", () => {
  it("makes one lead from the profile, the account's own, linked from the profile, with an audit row that holds ids only", async () => {
    const { user, values } = await onboarded();
    const response = await apply(user, body([programmes[2] as string, programmes[0] as string, programmes[1] as string]));
    expect(response.status).toBe(201);
    const { ref, status } = (await response.json()) as { ref: string; status: string };
    expect(status).toBe("created");

    // The details are the profile's, read on the server: the body carried none of them.
    const [lead] = (await t.run(`select id, ref, intake_kind, name, whatsapp_e164, country_code, qualification_type, results, user_id, stage_code, source, consent_notice_version from lead where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(lead).toMatchObject({ ref, intake_kind: "full", name: "Ada Eze", country_code: "NG", qualification_type: "olevel_alevel", user_id: user.userId, stage_code: "share_results" });
    expect(lead?.whatsapp_e164).toBe(values.contact_whatsapp);
    expect(lead?.results).toEqual([{ subject: "Mathematics", grade: "A" }]);
    expect(lead?.source).toMatchObject({ page: "apply", relationship: "student", contact_name: "Ada Eze", course_fields: ["computer_science_it", "law"], level: "undergraduate", intake_year: 2027 });

    const [profile] = (await t.run(`select lead_id, consent_notice_version from student_profile where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(profile?.lead_id).toBe(lead?.id);
    expect(lead?.consent_notice_version).toBe(profile?.consent_notice_version);

    // The programmes are kept in the order chosen: the first is the first choice.
    const prefs = (await t.run(`select programme_id, rank from lead_programme_pref where lead_id = ${q(lead?.id)} order by rank`)) as { programme_id: string; rank: number }[];
    expect(prefs.map((p) => p.programme_id)).toEqual([programmes[2], programmes[0], programmes[1]]);

    const activity = (await t.run(`select type from lead_activity where lead_id = ${q(lead?.id)} order by type`)) as { type: string }[];
    expect(activity.map((a) => a.type)).toEqual(["claimed", "created"]);
    expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(user.userId)} and method = 'auto' and status = 'approved'`)).toBe(1);

    const audit = (await t.run(`select meta from audit_log where action = 'application.submitted' and actor_id = ${q(user.userId)}`)) as { meta: Record<string, unknown> }[];
    expect(audit).toHaveLength(1);
    expect(Object.keys(audit[0]?.meta ?? {}).sort()).toEqual(["lead_id", "relationship"]);
    expect(JSON.stringify(audit)).not.toContain("Ada");
    expect(JSON.stringify(audit)).not.toContain(values.contact_whatsapp);
  });

  it("gives a parent's application the child's name and the parent's number, with the parent's name in the source", async () => {
    const { user, values } = await onboarded(parent());
    expect((await apply(user)).status).toBe(201);
    const [lead] = (await t.run(`select name, whatsapp_e164, country_code, source from lead where user_id = ${q(user.userId)}`)) as Record<string, unknown>[];
    expect(lead).toMatchObject({ name: "Chidi Eze", whatsapp_e164: values.contact_whatsapp, country_code: "NG" });
    expect(lead?.source).toMatchObject({ relationship: "parent", contact_name: "Ngozi Eze" });
  });

  it("answers the same request again with the same lead and writes nothing more (an offline retry, a double tap)", async () => {
    const { user } = await onboarded();
    const payload = body();
    const key = randomUUID();
    const first = await apply(user, payload, key);
    const again = await apply(user, payload, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    const firstJson = (await first.json()) as { ref: string };
    expect(await again.json()).toMatchObject({ status: "replayed", ref: firstJson.ref });
    expect(await leadsOf(user)).toBe(1);
    expect(await count(`select count(*)::int as n from audit_log where action = 'application.submitted' and actor_id = ${q(user.userId)}`)).toBe(1);
  });

  it("refuses the same key with different programmes", async () => {
    const { user } = await onboarded();
    const key = randomUUID();
    expect((await apply(user, body(programmes.slice(0, 3)), key)).status).toBe(201);
    const different = await apply(user, body(programmes.slice(1, 4)), key);
    expect(different.status).toBe(409);
    expect((await errorOf(different)).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await leadsOf(user)).toBe(1);
  });
});

describe("one application per account", () => {
  it("refuses a second application with ALREADY_APPLIED and the reference of the first (a second device, a stale page, a typed address)", async () => {
    const { user } = await onboarded();
    const first = await apply(user);
    const { ref } = (await first.json()) as { ref: string };
    const second = await apply(user, body(programmes.slice(1, 4)));
    expect(second.status).toBe(409);
    const error = await errorOf(second);
    expect(error.error.code).toBe("ALREADY_APPLIED");
    expect(error.error.fields).toEqual({ ref });
    expect(await leadsOf(user)).toBe(1);
  });

  // The profile row is locked for the rest of the transaction, so the second device queues and then finds the first one's lead. That is a
  // property of two database sessions, so it needs a real Postgres with two connections (the CI service container); the in-process engine has one.
  it.skipIf(!process.env.TEST_DATABASE_URL)("makes one application when two devices apply at the same moment (two connections)", async () => {
    const { user } = await onboarded();
    const extra = await openRuntimeConnections(2);
    try {
      const call = (db: Db) =>
        handleMutation(
          new Request(`${ORIGIN}/api/v1/me/application`, {
            method: "POST",
            headers: { cookie: cookieOf(user), origin: ORIGIN, "content-type": "application/json", "idempotency-key": randomUUID() },
            body: JSON.stringify(body()),
          }),
          () => ({ checkSession: facade.checkSession, mutations, env: { ...env, db }, limit: async () => ({ allowed: true, remaining: 100, retryAfterSeconds: 0 }) }),
        ) as Promise<Response>;
      const [a, b] = await Promise.all(extra.dbs.map((db) => call(db)));
      expect([a?.status, b?.status].sort()).toEqual([201, 409]);
    } finally {
      await extra.close();
    }
    expect(await leadsOf(user)).toBe(1);
    expect(await count(`select count(*)::int as n from audit_log where action = 'application.submitted' and actor_id = ${q(user.userId)}`)).toBe(1);
  });

  it("counts an application made before version 4 and claimed by the student", async () => {
    const { user } = await onboarded();
    const old = await leadRow(t, { user_id: user.userId, name: "Ada Old" });
    const refOld = ((await t.run(`select ref from lead where id = ${q(old)}`)) as { ref: string }[])[0]?.ref;
    const response = await apply(user);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).error.fields).toEqual({ ref: refOld });
    expect(await leadsOf(user)).toBe(1);
  });

  it("does not let one account's application touch another's", async () => {
    const first = await onboarded();
    const second = await onboarded();
    expect((await apply(first.user)).status).toBe(201);
    expect(await leadsOf(second.user)).toBe(0);
    expect((await apply(second.user)).status).toBe(201);
    expect(await leadsOf(first.user)).toBe(1);
  });
});

describe("what is refused", () => {
  it("needs three different programmes, known ones, and nothing else in the body", async () => {
    const { user } = await onboarded();
    const few = await apply(user, body(programmes.slice(0, 2)));
    expect(few.status).toBe(400);
    expect((await errorOf(few)).error.fields).toMatchObject({ programme_ids: "PROGRAMMES_MIN_3" });
    const twice = await apply(user, body([programmes[0] as string, programmes[0] as string, programmes[1] as string]));
    expect(twice.status).toBe(400);
    expect((await errorOf(twice)).error.fields).toMatchObject({ programme_ids: "DUPLICATE" });
    const unknown = await apply(user, body([programmes[0] as string, programmes[1] as string, randomUUID()]));
    expect(unknown.status).toBe(400);
    expect((await errorOf(unknown)).error.fields).toMatchObject({ programme_ids: "UNKNOWN_VALUE" });
    const extra = await apply(user, body(programmes.slice(0, 3), { name: "Someone Else", user_id: "x" }));
    expect(extra.status).toBe(400);
    expect(await leadsOf(user)).toBe(0);
    // Nothing was written, so the account can still apply.
    expect(((await t.run(`select lead_id from student_profile where user_id = ${q(user.userId)}`)) as { lead_id: string | null }[])[0]?.lead_id).toBeNull();
    expect((await apply(user)).status).toBe(201);
  });

  it("sends a person who has not finished onboarding to the questionnaire, and a missing profile the same way", async () => {
    const unfinished = await account();
    const first = await apply(unfinished);
    expect(first.status).toBe(403);
    expect((await errorOf(first)).error.code).toBe("ONBOARDING_REQUIRED");

    // Marked as done but with no profile (for example after the profile was removed): the database function refuses it too.
    const orphan = await account();
    await t.run(`update app_user set onboarding_done_at = now() where id = ${q(orphan.userId)}`);
    const second = await apply(orphan);
    expect(second.status).toBe(403);
    expect((await errorOf(second)).error.code).toBe("ONBOARDING_REQUIRED");
    expect(await leadsOf(orphan)).toBe(0);
  });

  it("refuses staff, a signed-out caller and an unconfirmed account", async () => {
    for (const role of ["admin", "owner"] as const) {
      const staff = await account(role);
      const response = await apply(staff);
      expect(response.status, role).toBe(403);
      expect(await leadsOf(staff)).toBe(0);
    }
    const stranger = await t.signIn({ expiresInMs: -60_000 });
    expect((await apply(stranger)).status).toBe(401);
    const unconfirmed = await account("student", false);
    const response = await apply(unconfirmed);
    expect(response.status).toBe(403);
    expect((await errorOf(response)).error.code).toBe("ACCOUNT_NOT_CONFIRMED");
  });

  it("applies the five-leads-a-day limit per number, and asks the phone to wait", async () => {
    const number = "+2348099999111";
    for (let i = 0; i < 5; i += 1) await leadRow(t, { whatsapp_e164: number });
    const { user } = await onboarded(student({ contact_whatsapp: number }));
    const response = await apply(user);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect((await errorOf(response)).error.fields).toEqual({ reason: "number_limit" });
    expect(await leadsOf(user)).toBe(0);
    expect(((await t.run(`select lead_id from student_profile where user_id = ${q(user.userId)}`)) as { lead_id: string | null }[])[0]?.lead_id).toBeNull();
  });
});

describe("a number that already has a lead", () => {
  it("still makes the application, and shows both to admins as a duplicate, never merged", async () => {
    const number = "+2348077772222";
    const earlier = await leadRow(t, { whatsapp_e164: number, name: "Ada From Elsewhere" });
    const { user } = await onboarded(student({ contact_whatsapp: number }));
    expect((await apply(user)).status).toBe(201);
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

describe("the Apply screen's data", () => {
  async function context(who: SignedInUser) {
    await t.asRuntime();
    try {
      const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(who) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
      return (await applicationDataCalls(env)["me/application-context"]?.(actor, { token: who.token, url: new URL(`${ORIGIN}/api/v1/me/application-context`) })) as {
        userId: string;
        onboarded: boolean;
        firstName: string | null;
        courseFields: string[];
        lead: { ref: string; stage: string } | null;
      };
    } finally {
      await t.asOwner();
    }
  }

  it("reads only the caller's own: not applied, then applied with the reference and stage", async () => {
    const { user } = await onboarded();
    const other = await onboarded();
    expect(await context(user)).toMatchObject({ userId: user.userId, onboarded: true, firstName: "Ada", courseFields: ["computer_science_it", "law"], lead: null });
    const { ref } = (await (await apply(user)).json()) as { ref: string };
    expect(await context(user)).toMatchObject({ lead: { ref, stage: "share_results" } });
    expect((await context(other.user)).lead).toBeNull();
  });
});

describe("the guard on the older lead endpoint", () => {
  const has = async (who: SignedInUser) => {
    await t.asRuntime();
    try {
      return await tokenHasApplication(t.db, who.token);
    } finally {
      await t.asOwner();
    }
  };

  it("knows a student who has applied, and nobody else", async () => {
    const { user } = await onboarded();
    expect(await has(user)).toBe(false);
    expect((await apply(user)).status).toBe(201);
    expect(await has(user)).toBe(true);

    const other = await onboarded();
    expect(await has(other.user)).toBe(false);
    const staff = await account("admin");
    await leadRow(t, { user_id: staff.userId });
    expect(await has(staff)).toBe(false);
  });

  it("does not count an anonymised application, and does not trust an ended session", async () => {
    const { user } = await onboarded();
    expect((await apply(user)).status).toBe(201);
    // How an erasure leaves a lead: the person's details go, the row stays for the counts (a database rule requires both).
    await t.run(`update lead set name = null, whatsapp_e164 = null, email = null, results = '[]'::jsonb, anonymised_at = now() where user_id = ${q(user.userId)}`);
    expect(await has(user)).toBe(false);
    const ended = await t.signIn({ expiresInMs: -60_000 });
    await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(ended.userId)}, 'student', now()) on conflict (id) do nothing`);
    await leadRow(t, { user_id: ended.userId });
    expect(await has(ended)).toBe(false);
  });
});
