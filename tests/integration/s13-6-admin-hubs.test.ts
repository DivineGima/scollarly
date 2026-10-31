import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { homeDataCalls, tourMutations } from "@/modules/dashboard/endpoints";
import { profileDataCalls } from "@/modules/profile/endpoints";
import { createAuthFacade } from "@/server/auth/facade";
import { type AuthedDeps, handleAuthed } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleMutation } from "@/server/edge/mutations";
import { resolveSession } from "@/server/repositories/identity";
import { createTestDb, type SignedInUser, type TestDb } from "./helpers/db";
import { leadRow, q, uni } from "./helpers/fixtures";

/**
 * S13.6 (architecture 21.9, 21.10), against a real database as the runtime role: the Home's numbers are the right ones for the role, an admin
 * never gets an owner number, and the tour is recorded for the caller only.
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

let ownerOnce: Promise<SignedInUser> | null = null;
function ownerAccount(): Promise<SignedInUser> {
  ownerOnce ??= (async () => {
    const user = await account("owner");
    await t.run(`insert into step_up (session_id, user_id, verified_at) values (${q(user.sessionId)}, ${q(user.userId)}, now())`);
    return user;
  })();
  return ownerOnce;
}

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const days = (n: number) => minutes(n * 24 * 60);

type Home = {
  period: string;
  role: string;
  days: number;
  series: { label: string; value: number }[];
  totals: { newLeads: { value: number; previous: number }; waiting: number; overdue: number; stageMoves: { value: number; previous: number }; pendingClaims: number; openDataRequests: number; payments: { valueCents: number; previousCents: number } | null; onboarded: { value: number; previous: number } | null };
  activity: { type: string; ref: string; leadId: string; at: string }[];
};

async function home(user: SignedInUser, period = "week"): Promise<Home> {
  await t.asRuntime();
  try {
    const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(user) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
    return (await homeDataCalls(env)["admin/home"]?.(actor, { token: user.token, url: new URL(`${ORIGIN}/api/v1/admin/home?period=${period}`) })) as Home;
  } finally {
    await t.asOwner();
  }
}

/** The numbers of a fresh database are not zero (other tests add leads), so each test measures what it adds. */
const delta = (after: number, before: number) => after - before;

describe("the staff Home", () => {
  it("counts the leads received this week and the week before, and the days they fall on", async () => {
    const admin = await account("admin");
    const before = await home(admin);
    await leadRow(t, { received_at: days(-1), name: "A" });
    await leadRow(t, { received_at: days(-1), name: "B" });
    await leadRow(t, { received_at: days(-9), name: "C" });
    await leadRow(t, { received_at: days(-40), name: "D" });
    const merged = await leadRow(t, { received_at: days(-1), name: "E" });
    await t.run(`update lead set merged_into_id = ${q(await leadRow(t, { received_at: days(-60) }))} where id = ${q(merged)}`);
    const after = await home(admin);
    expect(delta(after.totals.newLeads.value, before.totals.newLeads.value)).toBe(2);
    expect(delta(after.totals.newLeads.previous, before.totals.newLeads.previous)).toBe(1);
    expect(after.series).toHaveLength(7);
    expect(after.series.reduce((sum, p) => sum + p.value, 0) - before.series.reduce((sum, p) => sum + p.value, 0)).toBe(2);
    expect(after.days).toBe(7);
  });

  it("counts a month as 30 days against the 30 before", async () => {
    const admin = await account("admin");
    const before = await home(admin, "month");
    await leadRow(t, { received_at: days(-20) });
    await leadRow(t, { received_at: days(-45) });
    await leadRow(t, { received_at: days(-80) });
    const after = await home(admin, "month");
    expect(after.series).toHaveLength(30);
    expect(delta(after.totals.newLeads.value, before.totals.newLeads.value)).toBe(1);
    expect(delta(after.totals.newLeads.previous, before.totals.newLeads.previous)).toBe(1);
  });

  it("counts the leads waiting for a reply and the overdue ones for an admin: unassigned or theirs, unanswered, not arrived", async () => {
    const me = await account("admin");
    const other = await account("admin");
    const before = await home(me);
    await leadRow(t, { received_at: minutes(-300), sla_due_at: minutes(-30) }); // overdue, unassigned
    await leadRow(t, { received_at: minutes(-300), sla_due_at: minutes(120), assigned_admin_id: me.userId }); // waiting, mine
    await leadRow(t, { received_at: minutes(-300), sla_due_at: minutes(-30), assigned_admin_id: other.userId }); // another admin's
    await leadRow(t, { received_at: minutes(-300), sla_due_at: minutes(-30), first_response_at: minutes(-60) }); // answered
    await leadRow(t, { received_at: minutes(-300), sla_due_at: minutes(-30), stage_code: "arrived" }); // arrived
    const after = await home(me);
    expect(delta(after.totals.waiting, before.totals.waiting)).toBe(2);
    expect(delta(after.totals.overdue, before.totals.overdue)).toBe(1);
  });

  it("counts only the caller's own stage moves", async () => {
    const me = await account("admin");
    const other = await account("admin");
    const lead = await leadRow(t, { received_at: days(-1) });
    const before = await home(me);
    const move = (actor: SignedInUser, when: string) =>
      t.run(`insert into lead_activity (id, lead_id, type, actor_id, data, created_at) values (gen_random_uuid(), ${q(lead)}, 'stage_changed', ${q(actor.userId)}, '{"to":"choose_course"}'::jsonb, ${q(when)})`);
    await move(me, days(-1));
    await move(me, days(-2));
    await move(me, days(-9));
    await move(other, days(-1));
    const after = await home(me);
    expect(delta(after.totals.stageMoves.value, before.totals.stageMoves.value)).toBe(2);
    expect(delta(after.totals.stageMoves.previous, before.totals.stageMoves.previous)).toBe(1);
  });

  it("lists the latest eight activities, newest first, with the lead's reference", async () => {
    const admin = await account("admin");
    const lead = await leadRow(t, { received_at: days(-1) });
    for (let i = 0; i < 12; i += 1) await t.run(`insert into lead_activity (id, lead_id, type, actor_id, data, created_at) values (gen_random_uuid(), ${q(lead)}, 'note', null, '{}'::jsonb, ${q(minutes(i + 1))})`);
    const result = await home(admin);
    expect(result.activity).toHaveLength(8);
    const times = result.activity.map((a) => new Date(a.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(result.activity[0]?.ref).toMatch(/^SC-/);
  });

  it("counts the link requests and the data requests waiting", async () => {
    const admin = await account("admin");
    const claimant = await account();
    const lead = await leadRow(t, {});
    const before = await home(admin);
    await t.run(`insert into lead_claim (id, user_id, lead_id, method, status) values (gen_random_uuid(), ${q(claimant.userId)}, ${q(lead)}, 'ref', 'pending')`);
    await t.run(`insert into data_request (id, kind, channel, status, lead_id) values (gen_random_uuid(), 'export', 'portal', 'open', ${q(lead)})`);
    const after = await home(admin);
    expect(delta(after.totals.pendingClaims, before.totals.pendingClaims)).toBe(1);
    expect(delta(after.totals.openDataRequests, before.totals.openDataRequests)).toBe(1);
  });
});

describe("what each role is given", () => {
  it("gives an admin no payment and no onboarding number, even when there are some", async () => {
    const admin = await account("admin");
    const owner = await ownerAccount();
    const university = await uni(t, { name: "Paid University", status: "published" });
    await t.run(`insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by, entered_at) values (gen_random_uuid(), gen_random_uuid(), ${q(university)}, 150000, current_date, ${q(owner.userId)}, now())`);
    const result = await home(admin);
    expect(result.role).toBe("admin");
    expect(result.totals.payments).toBeNull();
    expect(result.totals.onboarded).toBeNull();
    expect(JSON.stringify(result)).not.toContain("150000");
  });

  it("gives the owner the payments received this period and the one before, without a voided one", async () => {
    const owner = await ownerAccount();
    const university = await uni(t, { name: "Owner University", status: "published" });
    const before = await home(owner);
    const pay = (cents: number, when: string, void_ = false) =>
      t.run(
        `insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by, entered_at${void_ ? ", voided_at, voided_by, void_reason" : ""}) values (gen_random_uuid(), gen_random_uuid(), ${q(university)}, ${cents}, current_date, ${q(owner.userId)}, ${q(when)}${void_ ? `, now(), ${q(owner.userId)}, 'entered twice'` : ""})`,
      );
    await pay(100000, days(-1));
    await pay(50000, days(-9));
    await pay(70000, days(-1), true);
    const after = await home(owner);
    expect(after.role).toBe("owner");
    expect((after.totals.payments?.valueCents ?? 0) - (before.totals.payments?.valueCents ?? 0)).toBe(100000);
    expect((after.totals.payments?.previousCents ?? 0) - (before.totals.payments?.previousCents ?? 0)).toBe(50000);
    expect(after.totals.onboarded).not.toBeNull();
  });

  it("refuses a student, and a signed-out caller, at the door of the area (the call is an admin call)", async () => {
    const student = await account();
    const run = async (cookie: string | null) => {
      const headers = new Headers(cookie ? { cookie } : {});
      const deps: AuthedDeps = {
        checkSession: (h) => facade.checkSession(h),
        cache: { match: async () => undefined, put: async () => undefined },
        next: async () => new Response("x"),
        waitUntil: () => undefined,
        api: homeDataCalls(env),
      };
      return (await handleAuthed(new Request(`${ORIGIN}/api/v1/admin/home`, { headers }), () => deps)) as Response;
    };
    await t.asRuntime();
    try {
      expect((await run(cookieOf(student))).status).toBe(403);
      expect((await run(null)).status).toBe(401);
    } finally {
      await t.asOwner();
    }
  });
});

describe("the first-visit tour", () => {
  const post = async (user: SignedInUser, body: unknown) => {
    await t.asRuntime();
    try {
      const request = new Request(`${ORIGIN}/api/v1/admin/tour.seen`, { method: "POST", headers: { cookie: cookieOf(user), origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
      return (await handleMutation(request, () => ({ checkSession: facade.checkSession, mutations: tourMutations, env, limit: async () => ({ allowed: true, remaining: 100, retryAfterSeconds: 0 }) }))) as Response;
    } finally {
      await t.asOwner();
    }
  };
  const session = async (user: SignedInUser) => {
    await t.asRuntime();
    try {
      const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(user) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
      return (await profileDataCalls(env)["admin/session"]?.(actor, { token: user.token, url: new URL(`${ORIGIN}/api/v1/admin/session`) })) as { toursSeen: string[]; userId: string; role: string };
    } finally {
      await t.asOwner();
    }
  };

  it("starts empty, records a tab once, and a second time changes nothing", async () => {
    const admin = await account("admin");
    expect((await session(admin)).toursSeen).toEqual([]);
    expect((await post(admin, { tab: "home" })).status).toBe(200);
    expect((await post(admin, { tab: "home" })).status).toBe(200);
    expect((await post(admin, { tab: "leads" })).status).toBe(200);
    const after = await session(admin);
    expect(after.toursSeen).toEqual(["home", "leads"]);
    expect(after.userId).toBe(admin.userId);
  });

  it("records it for the caller only", async () => {
    const first = await account("admin");
    const second = await account("admin");
    await post(first, { tab: "insights" });
    expect((await session(first)).toursSeen).toEqual(["insights"]);
    expect((await session(second)).toursSeen).toEqual([]);
  });

  it("refuses a tab that is not a tab, extra fields, and a student", async () => {
    const admin = await account("admin");
    expect((await post(admin, { tab: "Home!" })).status).toBe(400);
    expect((await post(admin, { tab: "team" })).status).toBe(400);
    expect((await post(admin, { tab: "home", role: "owner" })).status).toBe(400);
    expect((await post(admin, {})).status).toBe(400);
    expect((await session(admin)).toursSeen).toEqual([]);
    const student = await account();
    expect((await post(student, { tab: "home" })).status).toBe(403);
  });

  it("can never change a role: the function touches only the tour list", async () => {
    const admin = await account("admin");
    await post(admin, { tab: "content" });
    const [row] = (await t.run(`select role, tours_seen from app_user where id = ${q(admin.userId)}`)) as { role: string; tours_seen: string[] }[];
    expect(row).toEqual({ role: "admin", tours_seen: ["content"] });
  });
});
