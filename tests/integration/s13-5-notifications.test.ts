import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountMutations } from "@/modules/account/endpoints";
import { notificationDataCalls, notificationMutations } from "@/modules/notifications/endpoints";
import { onboardingMutations } from "@/modules/onboarding/endpoints";
import { buildOnboardingPayload, emptyValues, type OnboardingValues } from "@/modules/onboarding/payload";
import { createAuthFacade } from "@/server/auth/facade";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleMutation } from "@/server/edge/mutations";
import { resolveSession } from "@/server/repositories/identity";
import { createTestDb, type SignedInUser, type TestDb } from "./helpers/db";
import { leadRow, programmeRow, q, uni } from "./helpers/fixtures";

/**
 * S13.5 (architecture 21.8, ADR-045), against a real database as the runtime role: each person's notifications are derived from rows they may
 * read, "Mark all read" moves only their own time, an admin never sees an owner item, and the list is capped at 50.
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
const mutations = { ...accountMutations, ...onboardingMutations, ...notificationMutations };

async function account(role: "student" | "admin" | "owner" = "student"): Promise<SignedInUser> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(user.userId)}, ${q(role)}, now()) on conflict (id) do update set role = excluded.role, account_confirmed_at = excluded.account_confirmed_at`);
  return user;
}

let ownerOnce: Promise<SignedInUser> | null = null;
/** The one owner the database allows, signed in with a fresh second factor (an owner without one is only a student). */
function ownerAccount(): Promise<SignedInUser> {
  ownerOnce ??= (async () => {
    const user = await account("owner");
    await t.run(`insert into step_up (session_id, user_id, verified_at) values (${q(user.sessionId)}, ${q(user.userId)}, now())`);
    return user;
  })();
  return ownerOnce;
}

async function post(user: SignedInUser, path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<Response> {
  await t.asRuntime();
  try {
    const request = new Request(`${ORIGIN}${path}`, { method: "POST", headers: { cookie: cookieOf(user), origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
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
  level: "undergraduate",
  // A course no other test uses, so a university another test publishes never counts as a new match for these students.
  course_fields: ["civil_engineering"],
  intake_year: 2027,
  consent: true,
  ...over,
});

async function onboard(user: SignedInUser, values: OnboardingValues = student()): Promise<string> {
  const response = await post(user, "/api/v1/me/onboarding", buildOnboardingPayload(values, { locale: "en" }), { "idempotency-key": randomUUID() });
  expect(response.status).toBe(201);
  return ((await t.run(`select id from lead where user_id = ${q(user.userId)}`)) as { id: string }[])[0]?.id ?? "";
}

type Item = { id: string; kind: string; unread: boolean; at: string; ref?: string; stage?: string; slug?: string; university?: string; count?: number; overdue?: boolean; leadId?: string; amountUsdCents?: number };
type List = { items: Item[]; unread: number };

async function list(user: SignedInUser, area: "me" | "admin", search = ""): Promise<List> {
  await t.asRuntime();
  try {
    const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(user) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
    const call = notificationDataCalls(env)[`${area}/notifications`];
    return (await call?.(actor, { token: user.token, url: new URL(`${ORIGIN}/api/v1/${area}/notifications${search}`) })) as List;
  } finally {
    await t.asOwner();
  }
}
const kinds = (l: List) => l.items.map((i) => i.kind).sort();

const activity = (leadId: string, type: string, data: Record<string, unknown> = {}, when = "now()") =>
  t.run(`insert into lead_activity (id, lead_id, type, actor_id, data, created_at) values (gen_random_uuid(), ${q(leadId)}, ${q(type)}, null, ${q(data)}, ${when})`);

describe("the student's notifications", () => {
  it("shows a stage change and an adviser's reply on their own application, unread, newest first", async () => {
    const user = await account();
    const leadId = await onboard(user);
    await activity(leadId, "stage_changed", { from: "share_results", to: "choose_course" }, "now() - interval '2 hours'");
    await activity(leadId, "reply_logged", { first: true }, "now() - interval '1 hour'");
    const result = await list(user, "me");
    expect(kinds(result)).toEqual(["reply_logged", "stage_changed"]);
    expect(result.items[0]?.kind).toBe("reply_logged");
    expect(result.items.find((i) => i.kind === "stage_changed")).toMatchObject({ stage: "choose_course", unread: true });
    expect(result.unread).toBe(2);
  });

  it("never shows another student's application or what staff wrote", async () => {
    const mine = await account();
    const theirs = await account();
    await onboard(mine);
    const theirLead = await onboard(theirs);
    await activity(theirLead, "stage_changed", { to: "visa" });
    await activity(theirLead, "note", { text: "private staff note" });
    const result = await list(mine, "me");
    expect(result.items.filter((i) => i.kind !== "finish_onboarding")).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private staff note");
  });

  it("only turns activity into items it names: a staff note or an assignment is not a notification", async () => {
    const user = await account();
    const leadId = await onboard(user);
    await activity(leadId, "note", { text: "x" });
    await activity(leadId, "assigned", { to: "someone" });
    expect(kinds(await list(user, "me"))).toEqual([]);
  });

  it("reminds a person who has not finished onboarding, until they do", async () => {
    const user = await account();
    expect(kinds(await list(user, "me"))).toEqual(["finish_onboarding"]);
    await onboard(user);
    expect(kinds(await list(user, "me"))).not.toContain("finish_onboarding");
  });

  it("tells them about a new university that offers a course they chose, once, and not about other courses", async () => {
    const user = await account();
    await onboard(user, student({ course_fields: ["health_nursing"] }));
    const university = await uni(t, { name: "Fresh University", status: "published" });
    await programmeRow(t, university, { field: "health_nursing", status: "published", published_at: new Date().toISOString() });
    await programmeRow(t, university, { field: "health_nursing", status: "published", published_at: new Date().toISOString() });
    const other = await uni(t, { name: "Other University", status: "published" });
    await programmeRow(t, other, { field: "pharmacy", status: "published", published_at: new Date().toISOString() });
    const result = await list(user, "me");
    const matches = result.items.filter((i) => i.kind === "new_match");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ university: "Fresh University", unread: true });
    expect(matches[0]?.slug).toBe(((await t.run(`select slug from university where id = ${q(university)}`)) as { slug: string }[])[0]?.slug);
  });

  it("does not tell them about a programme published before they joined, one still a draft, or at an unpublished university", async () => {
    const user = await account();
    await onboard(user, student({ course_fields: ["science_arts"] }));
    const before = await uni(t, { name: "Old University", status: "published" });
    await programmeRow(t, before, { field: "science_arts", status: "published", published_at: "2020-01-01T00:00:00Z", created_at: "2020-01-01T00:00:00Z" });
    const draft = await uni(t, { name: "Draft Programme University", status: "published" });
    await programmeRow(t, draft, { field: "science_arts", status: "draft", published_at: new Date().toISOString() });
    const hidden = await uni(t, { name: "Hidden University", status: "draft" });
    await programmeRow(t, hidden, { field: "science_arts", status: "published", published_at: new Date().toISOString() });
    expect((await list(user, "me")).items.filter((i) => i.kind === "new_match")).toEqual([]);
  });

  it("marks all read without losing the list, and a later change is unread again", async () => {
    const user = await account();
    const leadId = await onboard(user);
    await activity(leadId, "stage_changed", { to: "choose_course" }, "now() - interval '1 minute'");
    expect((await list(user, "me")).unread).toBe(1);

    const response = await post(user, "/api/v1/me/notifications.seen");
    expect(response.status).toBe(200);
    const after = await list(user, "me");
    expect(after.unread).toBe(0);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.unread).toBe(false);

    await t.run(`select pg_sleep(0.05)`);
    await activity(leadId, "reply_logged", {}, "now() + interval '1 second'");
    const again = await list(user, "me");
    expect(again.unread).toBe(1);
    expect(again.items.find((i) => i.kind === "reply_logged")?.unread).toBe(true);
  });

  it("answers only the number for ?count=1", async () => {
    const user = await account();
    const leadId = await onboard(user);
    await activity(leadId, "stage_changed", { to: "choose_course" });
    expect(await list(user, "me", "?count=1")).toEqual({ unread: 1 });
  });

  it("moves only the caller's own time: another student's unread count is untouched", async () => {
    const first = await account();
    const second = await account();
    const firstLead = await onboard(first);
    const secondLead = await onboard(second);
    await activity(firstLead, "stage_changed", { to: "choose_course" });
    await activity(secondLead, "stage_changed", { to: "choose_course" });
    await post(first, "/api/v1/me/notifications.seen");
    expect((await list(first, "me")).unread).toBe(0);
    expect((await list(second, "me")).unread).toBe(1);
    const seen = (await t.run(`select id, notifications_seen_at from app_user where id in (${q(first.userId)}, ${q(second.userId)})`)) as { id: string; notifications_seen_at: unknown }[];
    expect(seen.find((r) => r.id === first.userId)?.notifications_seen_at).not.toBeNull();
    expect(seen.find((r) => r.id === second.userId)?.notifications_seen_at).toBeNull();
  });
});

describe("a staff member's notifications", () => {
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const lead = (over: Record<string, unknown> = {}) => leadRow(t, { name: "Probe Lead", ...over });

  it("shows a new lead that is unassigned or theirs, and hides one assigned to another admin", async () => {
    const me = await account("admin");
    const other = await account("admin");
    const unassigned = await lead({ received_at: minutes(-5) });
    const mine = await lead({ received_at: minutes(-6), assigned_admin_id: me.userId });
    const theirs = await lead({ received_at: minutes(-7), assigned_admin_id: other.userId });
    const result = await list(me, "admin");
    const ids = result.items.filter((i) => i.kind === "new_lead").map((i) => i.leadId);
    expect(ids).toContain(unassigned);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("shows a lead whose reply is due within the hour, or overdue, and nothing once it has been answered or has arrived", async () => {
    const me = await account("admin");
    const soon = await lead({ received_at: minutes(-300), sla_due_at: minutes(30) });
    const late = await lead({ received_at: minutes(-300), sla_due_at: minutes(-30) });
    const farAway = await lead({ received_at: minutes(-300), sla_due_at: minutes(90) });
    const answered = await lead({ received_at: minutes(-300), sla_due_at: minutes(-30), first_response_at: minutes(-60) });
    const arrived = await lead({ received_at: minutes(-300), sla_due_at: minutes(-30), stage_code: "arrived" });
    const sla = (await list(me, "admin")).items.filter((i) => i.kind === "sla_due");
    const byLead = new Map(sla.map((i) => [i.leadId, i]));
    expect(byLead.get(soon)?.overdue).toBe(false);
    expect(byLead.get(late)?.overdue).toBe(true);
    expect(byLead.has(farAway)).toBe(false);
    expect(byLead.has(answered)).toBe(false);
    expect(byLead.has(arrived)).toBe(false);
  });

  it("shows a lead nobody has touched for three days, not one touched two days ago", async () => {
    const me = await account("admin");
    const waiting = await lead({ received_at: minutes(-60 * 24 * 5), last_activity_at: minutes(-60 * 24 * 4) });
    const recent = await lead({ received_at: minutes(-60 * 24 * 5), last_activity_at: minutes(-60 * 24 * 2) });
    const ids = (await list(me, "admin")).items.filter((i) => i.kind === "lead_waiting").map((i) => i.leadId);
    expect(ids).toContain(waiting);
    expect(ids).not.toContain(recent);
  });

  it("counts the link requests and data requests waiting, as one item each", async () => {
    const me = await account("admin");
    const student1 = await account();
    const student2 = await account();
    const target = await lead();
    for (const user of [student1, student2]) {
      await t.run(`insert into lead_claim (id, user_id, lead_id, method, status) values (gen_random_uuid(), ${q(user.userId)}, ${q(target)}, 'ref', 'pending')`);
    }
    await t.run(`insert into data_request (id, kind, channel, status, lead_id) values (gen_random_uuid(), 'export', 'portal', 'open', ${q(target)})`);
    const result = await list(me, "admin");
    expect(result.items.find((i) => i.kind === "link_requests")?.count).toBeGreaterThanOrEqual(2);
    expect(result.items.find((i) => i.kind === "data_requests")?.count).toBeGreaterThanOrEqual(1);
  });

  it("is refused to a student, and the owner-only items never reach an admin", async () => {
    const admin = await account("admin");
    const owner = await ownerAccount();
    const university = await uni(t, { name: "Paid University", status: "published" });
    await t.run(`insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by, entered_at) values (gen_random_uuid(), gen_random_uuid(), ${q(university)}, 150000, current_date, ${q(owner.userId)}, now())`);
    expect(kinds(await list(admin, "admin"))).not.toContain("payment");
    const ownerItems = (await list(owner, "admin")).items.filter((i) => i.kind === "payment");
    expect(ownerItems.length).toBeGreaterThanOrEqual(1);
    expect(ownerItems.find((i) => i.university === "Paid University")).toMatchObject({ amountUsdCents: 150000, unread: true });

    const asStudent = await account();
    await t.asRuntime();
    try {
      const actor = (await facade.checkSession(new Headers({ cookie: cookieOf(asStudent) }))) as NonNullable<Awaited<ReturnType<typeof facade.checkSession>>>;
      await expect(notificationDataCalls(env)["admin/notifications"]?.(actor, { token: asStudent.token, url: new URL(`${ORIGIN}/api/v1/admin/notifications`) })).resolves.toMatchObject({ items: [] });
    } finally {
      await t.asOwner();
    }
  });

  it("does not show a voided payment", async () => {
    const owner = await ownerAccount();
    const university = await uni(t, { name: "Void University", status: "published" });
    await t.run(`insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by, entered_at, voided_at, voided_by, void_reason) values (gen_random_uuid(), gen_random_uuid(), ${q(university)}, 99900, current_date, ${q(owner.userId)}, now(), now(), ${q(owner.userId)}, 'entered twice')`);
    expect((await list(owner, "admin")).items.find((i) => i.university === "Void University")).toBeUndefined();
  });

  it("marks all read for the caller only, and the admin route refuses a student", async () => {
    const admin = await account("admin");
    const other = await account("admin");
    await lead({ received_at: minutes(-1) });
    expect((await list(admin, "admin")).unread).toBeGreaterThan(0);
    expect((await post(admin, "/api/v1/admin/notifications.seen")).status).toBe(200);
    expect((await list(admin, "admin")).unread).toBe(0);
    expect((await list(other, "admin")).unread).toBeGreaterThan(0);
    const asStudent = await account();
    expect((await post(asStudent, "/api/v1/admin/notifications.seen")).status).toBe(403);
  });

  it("returns at most 50 items", async () => {
    const admin = await account("admin");
    for (let i = 0; i < 25; i += 1) await lead({ received_at: minutes(-i - 1), sla_due_at: minutes(-i - 1) });
    for (let i = 0; i < 25; i += 1) await lead({ received_at: minutes(-i - 30), sla_due_at: minutes(-i - 30), last_activity_at: minutes(-60 * 24 * 4) });
    const result = await list(admin, "admin");
    expect(result.items.length).toBeLessThanOrEqual(50);
    expect(result.items.length).toBeGreaterThan(20);
  });
});

describe("the student's function", () => {
  it("is refused to a call with no signed-in person", async () => {
    await t.asRuntime();
    try {
      await expect(t.run(`select * from public.app_my_notifications()`)).rejects.toThrow();
    } finally {
      await t.asOwner();
    }
  });
});
