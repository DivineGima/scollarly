/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read nested JSON answers; typing every shape would hide what each test checks */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crmDataCalls } from "@/modules/crm/endpoints";
import { leadDataCalls } from "@/modules/leads/admin-endpoints";
import { type Actor, mintActor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { listNotApplied } from "@/server/repositories/not-applied";
import { createTestDb, type TestDb } from "./helpers/db";
import { applyForProfile, leadRow, q } from "./helpers/fixtures";

/**
 * S15.6 against a real database, as the non-owner runtime role (ADR-038): the "Not applied yet" list holds profiles with no lead, newest first,
 * with the name cut to a first name and an initial; a student cannot read other students' profiles through it; and none of it changes a lead
 * count (PRD_4 F27, FR-38; architecture 23.6). The Insights overview gains the onboarded numbers and the first funnel step.
 */

let t: TestDb;
let admin: Actor;
let student: Actor;
// 2026-10-26 12:00 UTC is 13:00 WAT.
const NOW = new Date("2026-10-26T12:00:00Z");
const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => NOW });
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

async function actorOf(role: "manager" | "admin" | "student"): Promise<Actor> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(user.userId)}, ${q(role)}, now())`);
  return mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: role, role, twoFactorVerifiedAt: null });
}

async function profile(user: Actor, name: string, country: string, onboardedAt: string): Promise<void> {
  await t.run(`insert into student_profile (user_id, relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164, qualification_type, level, course_fields, intake_year, consent_notice_version, consent_at, onboarded_at)
    values (${q(user.userId)}, 'student', ${q(name)}, ${q(country)}, ${q(name)}, '+237612345678', 'olevel_alevel', 'undergraduate', ARRAY['law'], 2027, 'v1', now(), ${q(onboardedAt)})`);
}

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

async function call(calls: Record<string, DataCall>, name: string, actor: Actor, query = ""): Promise<any> {
  const result = await asRuntime(() => calls[`admin/${name}`]!(actor, { token: null, url: new URL(`https://example.test/api/v1/admin/${name}${query}`) }));
  return JSON.parse(JSON.stringify(result));
}

let older: Actor;
let newer: Actor;
let applied: Actor;

beforeAll(async () => {
  t = await createTestDb();
  admin = await actorOf("admin");
  student = await actorOf("student");
  older = await actorOf("student");
  newer = await actorOf("student");
  applied = await actorOf("student");
  await profile(older, "Amina Nkeng Fon", "CM", day(3));
  await profile(newer, "kofi", "GH", day(1));
  await profile(applied, "Ada Obi", "NG", day(2));
  await applyForProfile(t, applied.userId, { received_at: day(1), sla_due_at: day(0) });
  await profile(student, "Own Student", "CM", day(5));
});

afterAll(async () => {
  await t.close();
});

describe("admin/not-applied", () => {
  it("lists the profiles with no lead, newest first, with a first name and an initial, and leaves out the one who applied", async () => {
    const answer = await call(leadDataCalls(env()), "not-applied", admin);
    expect(answer.total).toBe(3);
    expect(answer.students.map((s: any) => s.name)).toEqual(["kofi", "Amina F.", "Own S."]);
    expect(answer.students[0]).toMatchObject({ country: "GH", courseFields: ["law"], whatsapp: "+237612345678" });
    expect(JSON.stringify(answer)).not.toContain("Nkeng");
  });

  it("does not change a lead count or the response clock", async () => {
    const leads = (await call(leadDataCalls(env()), "overview", admin)) as any;
    const before = { unanswered: leads.unanswered, today: leads.today, funnel: leads.funnel };
    await profile(await actorOf("student"), "Another Person", "CM", day(0));
    const after = (await call(leadDataCalls(env()), "overview", admin)) as any;
    expect({ unanswered: after.unanswered, today: after.today, funnel: after.funnel }).toEqual(before);
    expect(before.unanswered).toBe(1);
  });

  it("shows a student only their own row when the repository is called as that student (row level security)", async () => {
    const own = await asRuntime(() => listNotApplied(t.db, student));
    expect(own.rows.map((r) => r.userId)).toEqual([student.userId]);
  });

  it("caps the page and still reports the whole count", async () => {
    const capped = await asRuntime(() => listNotApplied(t.db, admin, 2));
    expect(capped.rows).toHaveLength(2);
    expect(capped.total).toBeGreaterThanOrEqual(3);
  });
});

describe("admin/crm onboarding numbers", () => {
  // A manager sees only the students and leads assigned to them (version 5), so this group works as one manager who has them all.
  let mgr: Actor;
  beforeAll(async () => {
    mgr = await actorOf("manager");
    await t.run(`update student_profile set assigned_manager_id = ${q(mgr.userId)}`);
    await t.run(`update lead set assigned_manager_id = ${q(mgr.userId)}`);
  });

  it("adds onboarded, applied of onboarded and the first funnel step, and leaves the lead numbers alone", async () => {
    await leadRow(t, { received_at: day(1), sla_due_at: day(0), assigned_manager_id: mgr.userId });
    const answer = await call(crmDataCalls(env()), "crm", mgr);
    expect(answer.totals.onboarded).toBeGreaterThanOrEqual(4);
    expect(answer.totals.appliedOfOnboarded).toBe(1);
    expect(answer.totals.appliedOfOnboardedPercent).toBe(Math.round((1 / answer.totals.onboarded) * 100));
    expect(answer.funnel[0]).toMatchObject({ code: "profile_onboarded", reached: answer.totals.onboarded, ofPrevious: null });
    expect(answer.funnel[1].code).not.toBe("profile_onboarded");
    expect(answer.totals.leads).toBe(2);
  });

  it("follows the country filter and drops the onboarding numbers when a filter a profile does not have is set", async () => {
    const gh = await call(crmDataCalls(env()), "crm", mgr, "?country=GH");
    expect(gh.totals.onboarded).toBe(1);
    const bySource = await call(crmDataCalls(env()), "crm", mgr, "?source=%2Fapply");
    expect(bySource.totals.onboarded).toBeNull();
    expect(bySource.totals.appliedOfOnboardedPercent).toBeNull();
    expect(bySource.funnel[0].code).not.toBe("profile_onboarded");
    const mine = await call(crmDataCalls(env()), "crm", mgr, "?assigned=me");
    expect(mine.totals.onboarded).toBeNull();
  });
});
