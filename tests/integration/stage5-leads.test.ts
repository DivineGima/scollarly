import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, mintActor } from "@/server/auth/actor";
import { uuidv7 } from "@/lib/uuid";
import { slaStatus } from "@/modules/sla/service";
import { decideClaim, listPendingClaims } from "@/server/repositories/claims";
import { completeDataRequest, listDataRequests, logDataRequest } from "@/server/repositories/data-requests";
import { listTeam } from "@/server/repositories/team";
import {
  addNote,
  assignLead,
  changeStage,
  eraseLead,
  getLeadScreen,
  getOverviewCounts,
  listDuplicatePairs,
  listLeadsAdmin,
  listStageNames,
  logAdminWhatsAppOpen,
  logReply,
  resolveDuplicate,
  type LeadListFilters,
} from "@/server/repositories/lead-admin";
import { createTestDb, type TestDb } from "./helpers/db";
import { insertRow, leadRow, q, uni } from "./helpers/fixtures";

/**
 * Stage 5 against a real database, as the non-owner runtime role (ADR-038): the lead list and its filters, every change an
 * admin makes (stage, assignment, note, reply, duplicates), link requests, data requests and erasure. What is proven here is
 * what the exit criteria of Stage 5 ask for: append-only activity, first reply set once, the overdue view reading the stored
 * target, approval refused without a verification method, and an erasure that is all or nothing.
 */

let t: TestDb;
let admin: Actor;
let admin2: Actor;
let student: Actor;
const NOW = new Date("2026-10-21T12:00:00Z");

async function staff(role: "admin" | "owner" | "student"): Promise<Actor> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role) values (${q(user.userId)}, ${q(role)})`);
  return mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: role, role, twoFactorVerifiedAt: null });
}

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

const rows = (sql: string) => t.run(sql) as Promise<Record<string, unknown>[]>;
const count = async (sql: string) => Number((await rows(sql))[0]?.n);
const versionOf = async (id: string) => String((await rows(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as v from lead where id = ${q(id)}`))[0]?.v);

const filters = (over: Partial<LeadListFilters> = {}): LeadListFilters => ({ view: "all", limit: 50, now: NOW, ...over });
const refOf = async (id: string) => String((await rows(`select ref from lead where id = ${q(id)}`))[0]?.ref);

beforeAll(async () => {
  t = await createTestDb();
  admin = await staff("admin");
  admin2 = await staff("admin");
  student = await staff("student");
});

afterAll(async () => {
  await t.close();
});

describe("S5.1 the list, its filters and search", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const u = await uni(t, { status: "published", name: "Alpha University" });
    ids.uni = u;
    const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
    ids.ama = await leadRow(t, { name: "Ama Mensah", whatsapp_e164: "+233201111111", country_code: "GH", received_at: at(10), sla_due_at: at(6), source: { university_id: u } });
    ids.kofi = await leadRow(t, { name: "Kofi Boateng", whatsapp_e164: "+233202222222", country_code: "GH", received_at: at(5), sla_due_at: at(1), assigned_admin_id: admin.userId });
    ids.ngozi = await leadRow(t, { name: "Ngozi Eze", whatsapp_e164: "+2348033333333", country_code: "NG", received_at: at(2), sla_due_at: at(-2), stage_code: "choose_course" });
    ids.answered = await leadRow(t, { name: "Answered Person", whatsapp_e164: "+237600000001", received_at: at(8), sla_due_at: at(4), first_response_at: at(7) });
    ids.merged = await leadRow(t, { name: "Merged Away", whatsapp_e164: "+233201111111", received_at: at(9), sla_due_at: at(5), merged_into_id: ids.ama });
  });

  const list = (over: Partial<LeadListFilters> = {}) => asRuntime(() => listLeadsAdmin(t.db, admin, filters(over)));

  it("lists newest first and never lists a merged lead", async () => {
    const result = await list();
    expect(result.map((r) => r.id)).toEqual([ids.ngozi, ids.kofi, ids.answered, ids.ama]);
    expect(result.some((r) => r.id === ids.merged)).toBe(false);
  });

  it("filters by stage, country, assigned admin and university", async () => {
    expect((await list({ stage: "choose_course" })).map((r) => r.id)).toEqual([ids.ngozi]);
    expect((await list({ country: "NG" })).map((r) => r.id)).toEqual([ids.ngozi]);
    expect((await list({ assigned: "me" })).map((r) => r.id)).toEqual([ids.kofi]);
    expect((await list({ assigned: admin.userId })).map((r) => r.id)).toEqual([ids.kofi]);
    expect((await list({ universityId: ids.uni })).map((r) => r.id)).toEqual([ids.ama]);
  });

  it("the Unassigned view lists leads with no admin, and the Unanswered view those with no first reply", async () => {
    expect((await list({ view: "unassigned" })).map((r) => r.id).sort()).toEqual([ids.ama, ids.ngozi, ids.answered].sort());
    expect((await list({ view: "unanswered" })).map((r) => r.id).sort()).toEqual([ids.ama, ids.kofi, ids.ngozi].sort());
  });

  it("the Overdue view lists unanswered leads past their STORED target, oldest due first, and never recalculates", async () => {
    // Ama was due 6 h ago, Kofi 1 h ago; Ngozi is due in 2 h; the answered lead is never overdue.
    expect((await list({ view: "overdue" })).map((r) => r.id)).toEqual([ids.ama, ids.kofi]);
    // Later the same day Ngozi is past her stored target too. Nothing about the lead changed: only the clock.
    const later = await list({ view: "overdue", now: new Date(NOW.getTime() + 3 * 3_600_000) });
    expect(later.map((r) => r.id)).toEqual([ids.ama, ids.kofi, ids.ngozi]);
    // The badge agrees with the list.
    const ngozi = later.find((r) => r.id === ids.ngozi);
    expect(ngozi && slaStatus(ngozi, new Date(NOW.getTime() + 3 * 3_600_000))).toBe("overdue");
  });

  it("searches by name, reference and WhatsApp number (any layout of the digits), and treats LIKE characters as text", async () => {
    expect((await list({ q: "ngozi" })).map((r) => r.id)).toEqual([ids.ngozi]);
    expect((await list({ q: (await refOf(ids.kofi as string)).toLowerCase() })).map((r) => r.id)).toEqual([ids.kofi]);
    expect((await list({ q: "+233 20 111 1111" })).map((r) => r.id)).toEqual([ids.ama]);
    expect((await list({ q: "2222" })).map((r) => r.id)).toEqual([ids.kofi]);
    expect(await list({ q: "%" })).toEqual([]);
    expect(await list({ q: "_" })).toEqual([]);
  });

  it("pages with a keyset cursor and returns every lead exactly once", async () => {
    const first = await list({ limit: 2 });
    const second = await list({ limit: 2, before: first[1]?.id as string });
    const third = await list({ limit: 2, before: second[1]?.id as string });
    expect([...first, ...second, ...third].map((r) => r.id)).toEqual([ids.ngozi, ids.kofi, ids.answered, ids.ama]);
  });

  it("the Overview counts come from the same stored fields", async () => {
    const day = { start: new Date("2026-10-21T00:00:00Z"), end: new Date("2026-10-22T00:00:00Z") };
    const counts = await asRuntime(() => getOverviewCounts(t.db, admin, NOW, day.start, day.end));
    expect(counts.unanswered).toBe(3);
    expect(counts.overdue).toBe(2);
    expect(counts.mine).toBe(1);
    expect(counts.unassigned).toBe(3);
    expect(counts.funnel.reduce((n, f) => n + f.count, 0)).toBe(4);
    expect(counts.funnel.find((f) => f.stageCode === "choose_course")?.count).toBe(1);
  });

  it("a student and a visitor see no lead, because the policy says so, not because the screen hides them", async () => {
    expect(await asRuntime(() => listLeadsAdmin(t.db, student, filters()))).toEqual([]);
  });
});

describe("S5.2 and S5.6 changes, activity and versions", () => {
  let id: string;
  let version: string;

  beforeAll(async () => {
    id = await leadRow(t, { name: "Change Me", whatsapp_e164: "+237611000111" });
    version = await versionOf(id);
  });

  it("changing the stage writes a stage_changed activity and an audit row, and moves the version", async () => {
    const result = await asRuntime(() => changeStage(t.db, admin, { leadId: id, stage: "choose_course", version }));
    expect(result).toMatchObject({ kind: "ok", from: "share_results" });
    const activity = await rows(`select type, actor_id, data from lead_activity where lead_id = ${q(id)}`);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ type: "stage_changed", actor_id: admin.userId, data: { from: "share_results", to: "choose_course" } });
    expect(await count(`select count(*) as n from audit_log where action = 'leads.changeStage' and entity_id = ${q(id)}`)).toBe(1);
    expect(result.kind === "ok" && result.version).toBe(await versionOf(id));
    expect(await versionOf(id)).not.toBe(version);
    version = await versionOf(id);
  });

  it("a stale version changes nothing and reports a conflict (S5.6)", async () => {
    const stale = "2000-01-01T00:00:00.000000Z";
    const before = await count(`select count(*) as n from lead_activity where lead_id = ${q(id)}`);
    const result = await asRuntime(() => changeStage(t.db, admin2, { leadId: id, stage: "offer_letter", version: stale }));
    expect(result.kind).toBe("conflict");
    expect(await rows(`select stage_code from lead where id = ${q(id)}`)).toEqual([{ stage_code: "choose_course" }]);
    expect(await count(`select count(*) as n from lead_activity where lead_id = ${q(id)}`)).toBe(before);
  });

  it("two admins saving from the same version: one wins, the other is told to reload", async () => {
    const first = await asRuntime(() => assignLead(t.db, admin, { leadId: id, adminId: admin.userId, version }));
    expect(first.kind).toBe("ok");
    const second = await asRuntime(() => assignLead(t.db, admin2, { leadId: id, adminId: admin2.userId, version }));
    expect(second.kind).toBe("conflict");
    expect(await rows(`select assigned_admin_id from lead where id = ${q(id)}`)).toEqual([{ assigned_admin_id: admin.userId }]);
    version = await versionOf(id);
  });

  it("the same stage again is 'unchanged', an unknown stage is refused, and neither writes anything", async () => {
    const before = await count(`select count(*) as n from lead_activity where lead_id = ${q(id)}`);
    expect((await asRuntime(() => changeStage(t.db, admin, { leadId: id, stage: "choose_course", version }))).kind).toBe("unchanged");
    expect((await asRuntime(() => changeStage(t.db, admin, { leadId: id, stage: "no_such_stage", version }))).kind).toBe("unknown_stage");
    expect(await count(`select count(*) as n from lead_activity where lead_id = ${q(id)}`)).toBe(before);
  });

  it("a note keeps its text in lead_note, the activity holds only its id, and the version does not move", async () => {
    const before = await versionOf(id);
    const result = await asRuntime(() => addNote(t.db, admin2, { leadId: id, body: "Called, no answer. Her mother's number is private." }));
    expect(result.kind).toBe("ok");
    const [activity] = await rows(`select data from lead_activity where lead_id = ${q(id)} and type = 'note'`);
    const data = activity?.data as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["note_id"]);
    expect(JSON.stringify(data)).not.toContain("Called");
    expect(await rows(`select body, author_id from lead_note where lead_id = ${q(id)}`)).toEqual([{ body: "Called, no answer. Her mother's number is private.", author_id: admin2.userId }]);
    // Someone else's note must not make an admin's stage change fail.
    expect(await versionOf(id)).toBe(before);
  });

  it("the first reply sets first_response_at once and the SLA badge becomes Met; later replies only add to the timeline", async () => {
    const first = await asRuntime(() => logReply(t.db, admin, id));
    expect(first).toMatchObject({ kind: "ok", first: true });
    const stampedAt = async () => (await rows(`select first_response_at from lead where id = ${q(id)}`))[0]?.first_response_at;
    const stamped = await stampedAt();
    expect(stamped).not.toBeNull();
    const second = await asRuntime(() => logReply(t.db, admin2, id));
    expect(second).toMatchObject({ kind: "ok", first: false });
    expect(new Date(String(await stampedAt())).getTime()).toBe(new Date(String(stamped)).getTime());
    expect(await count(`select count(*) as n from lead_activity where lead_id = ${q(id)} and type = 'reply_logged'`)).toBe(2);
    const detail = await asRuntime(() => getLeadScreen(t.db, admin, id));
    expect(detail && slaStatus(detail.lead, new Date())).toBe("met");
  });

  it("opening WhatsApp is logged as admin_wa_opened and nothing else", async () => {
    const before = await versionOf(id);
    expect((await asRuntime(() => logAdminWhatsAppOpen(t.db, admin, id))).kind).toBe("ok");
    expect(await count(`select count(*) as n from lead_activity where lead_id = ${q(id)} and type = 'admin_wa_opened'`)).toBe(1);
    expect(await versionOf(id)).toBe(before);
  });

  it("the detail read joins programmes, activity and notes, newest activity first", async () => {
    const detail = await asRuntime(() => getLeadScreen(t.db, admin, id));
    expect(detail?.activities[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(detail?.activities[1]?.createdAt.getTime() ?? 0);
    expect(detail?.notes).toHaveLength(1);
    expect(detail?.lead.version).toBe(await versionOf(id));
    expect(await asRuntime(() => getLeadScreen(t.db, admin, uuidv7()))).toBeNull();
  });

  it("the lead screen in one round trip also carries the stages, team and duplicates, and is null for a lead that does not exist", async () => {
    const screen = await asRuntime(() => getLeadScreen(t.db, admin, id));
    expect(screen).not.toBeNull();
    expect(screen?.stages).toEqual(await asRuntime(() => listStageNames(t.db, admin)));
    expect(screen?.team).toEqual(await asRuntime(() => listTeam(t.db, admin)));
    expect(screen?.duplicates).toEqual(await asRuntime(() => listDuplicatePairs(t.db, admin, { leadId: id, limit: 5 })));
    expect(await asRuntime(() => getLeadScreen(t.db, admin, uuidv7()))).toBeNull();
    // A student is refused by row level security: no lead row, so no screen.
    expect(await asRuntime(() => getLeadScreen(t.db, student, id))).toBeNull();
  });

  it("lead_activity is append-only: the runtime role cannot update or delete a row, whoever it is", async () => {
    await t.asRuntime();
    try {
      await expect(t.run(`update lead_activity set type = 'created' where lead_id = ${q(id)}`)).rejects.toThrow();
      await expect(t.run(`delete from lead_activity where lead_id = ${q(id)}`)).rejects.toThrow();
    } finally {
      await t.asOwner();
    }
  });

  it("a student cannot work a lead: the policies refuse every change", async () => {
    // The student cannot even see the lead, so every change finds nothing to change and writes nothing.
    const current = await versionOf(id);
    expect((await asRuntime(() => changeStage(t.db, student, { leadId: id, stage: "visa", version: current }))).kind).toBe("not_found");
    expect((await asRuntime(() => addNote(t.db, student, { leadId: id, body: "x" }))).kind).toBe("not_found");
    expect((await asRuntime(() => logReply(t.db, student, id))).kind).toBe("not_found");
    expect(await count(`select count(*) as n from lead_note where body = 'x'`)).toBe(0);
    // And a direct write is refused by the policies.
    await t.asRuntime();
    try {
      await t.run(`set local app.role = 'student'`).catch(() => null);
      await expect(t.run(`insert into lead_note (id, lead_id, author_id, body) values (${q(uuidv7())}, ${q(id)}, 'nobody', 'x')`)).rejects.toThrow();
    } finally {
      await t.asOwner();
    }
  });

  it("an erased or merged lead can no longer be changed", async () => {
    const gone = await leadRow(t, { name: null, whatsapp_e164: null, email: null, results: [], anonymised_at: new Date().toISOString() });
    const goneVersion = await versionOf(gone);
    const result = await asRuntime(() => changeStage(t.db, admin, { leadId: gone, stage: "visa", version: goneVersion }));
    expect(result.kind).toBe("unavailable");
    expect((await asRuntime(() => addNote(t.db, admin, { leadId: gone, body: "x" }))).kind).toBe("unavailable");
    expect((await asRuntime(() => logReply(t.db, admin, gone))).kind).toBe("unavailable");
    expect((await asRuntime(() => logReply(t.db, admin, uuidv7()))).kind).toBe("not_found");
  });
});

describe("S5.4 duplicates: found by number, merged only by a person", () => {
  const num = "+237650000777";
  let a: string;
  let b: string;
  let c: string;

  beforeAll(async () => {
    a = await leadRow(t, { name: "Dup One", whatsapp_e164: num });
    b = await leadRow(t, { name: "Dup Two", whatsapp_e164: num });
    c = await leadRow(t, { name: "Dup Three", whatsapp_e164: num });
    await leadRow(t, { name: "Someone Else", whatsapp_e164: "+237650000888" });
  });

  it("finds every pair of live leads with the same number, and nothing is merged by looking", async () => {
    const pairs = await asRuntime(() => listDuplicatePairs(t.db, admin));
    const ours = pairs.filter((p) => [p.a.id, p.b.id].every((x) => [a, b, c].includes(x)));
    expect(ours).toHaveLength(3);
    expect(await count(`select count(*) as n from lead where merged_into_id is not null and whatsapp_e164 = ${q(num)}`)).toBe(0);
    expect((await asRuntime(() => listDuplicatePairs(t.db, admin, { leadId: a }))).every((p) => p.a.id === a || p.b.id === a)).toBe(true);
  });

  it("'not a duplicate' records the decision and the pair stops being offered", async () => {
    expect(await asRuntime(() => resolveDuplicate(t.db, admin, a, b, "not_duplicate"))).toBe("dismissed");
    expect(await count(`select count(*) as n from lead_duplicate_decision where decision = 'not_duplicate' and decided_by = ${q(admin.userId)}`)).toBe(1);
    expect(await count(`select count(*) as n from lead_activity where type = 'duplicate_dismissed' and lead_id in (${q(a)}, ${q(b)})`)).toBe(2);
    const pairs = await asRuntime(() => listDuplicatePairs(t.db, admin, { leadId: a }));
    expect(pairs.some((p) => [p.a.id, p.b.id].sort().join() === [a, b].sort().join())).toBe(false);
    // Deciding the same pair again, in either order, is refused.
    expect(await asRuntime(() => resolveDuplicate(t.db, admin2, b, a, "merged"))).toBe("already_decided");
  });

  it("merging sets merged_into_id on the other lead, hides it from the list, and writes both activities and an audit row", async () => {
    expect(await asRuntime(() => resolveDuplicate(t.db, admin, a, c, "merged"))).toBe("merged");
    expect(await rows(`select merged_into_id from lead where id = ${q(c)}`)).toEqual([{ merged_into_id: a }]);
    expect(await count(`select count(*) as n from lead_activity where type = 'merged' and lead_id in (${q(a)}, ${q(c)})`)).toBe(2);
    expect(await count(`select count(*) as n from audit_log where action = 'leads.resolveDuplicate' and entity_id = ${q(a)}`)).toBe(2);
    const listed = await asRuntime(() => listLeadsAdmin(t.db, admin, filters({ q: "Dup" })));
    expect(listed.map((r) => r.id)).not.toContain(c);
  });

  it("merging a lead that already has leads merged into it re-points them, so there is never a chain", async () => {
    const n = "+237650001234";
    const x = await leadRow(t, { name: "Chain X", whatsapp_e164: n });
    const y = await leadRow(t, { name: "Chain Y", whatsapp_e164: n });
    const z = await leadRow(t, { name: "Chain Z", whatsapp_e164: n });
    expect(await asRuntime(() => resolveDuplicate(t.db, admin, x, y, "merged"))).toBe("merged");
    // y was merged into x. Now x is merged into z: y must follow to z.
    expect(await asRuntime(() => resolveDuplicate(t.db, admin, z, x, "merged"))).toBe("merged");
    expect(await rows(`select id, merged_into_id from lead where id in (${q(x)}, ${q(y)})`)).toEqual(
      expect.arrayContaining([
        { id: x, merged_into_id: z },
        { id: y, merged_into_id: z },
      ]),
    );
  });

  it("refuses what is not a pair: different numbers, the same lead, a missing lead, an already merged lead", async () => {
    const other = await leadRow(t, { name: "Other Number", whatsapp_e164: "+237650000999" });
    expect(await asRuntime(() => resolveDuplicate(t.db, admin, b, other, "merged"))).toBe("not_a_pair");
    expect(await asRuntime(() => resolveDuplicate(t.db, admin, b, b, "merged"))).toBe("not_a_pair");
    expect(await asRuntime(() => resolveDuplicate(t.db, admin, b, uuidv7(), "merged"))).toBe("not_found");
    // c was merged away above.
    expect(await asRuntime(() => resolveDuplicate(t.db, admin, b, c, "merged"))).toBe("not_a_pair");
  });

  it("a student cannot resolve a duplicate", async () => {
    await expect(asRuntime(() => resolveDuplicate(t.db, student, a, b, "merged"))).rejects.toThrow();
  });
});

describe("S5.5 link requests: approval needs a verification method", () => {
  let lead: string;
  let claimUser: Actor;

  async function claim(userId: string, leadId: string, method = "ref"): Promise<string> {
    const id = uuidv7();
    await t.run(`insert into lead_claim (id, user_id, lead_id, method, status) values (${q(id)}, ${q(userId)}, ${q(leadId)}, ${q(method)}, 'pending')`);
    return id;
  }

  beforeAll(async () => {
    claimUser = await staff("student");
    await t.run(`update neon_auth."user" set email = 'claimer@example.test', name = 'Claim Er' where id = ${q(claimUser.userId)}`);
    lead = await leadRow(t, { name: "Claimed Lead", email: "claimer@example.test", whatsapp_e164: "+237655500001" });
  });

  it("lists pending claims with the student's name and email and whether the emails match", async () => {
    const id = await claim(claimUser.userId, lead);
    const pending = await asRuntime(() => listPendingClaims(t.db, admin));
    const mine = pending.find((c) => c.claimId === id);
    expect(mine).toMatchObject({ userEmail: "claimer@example.test", userName: "Claim Er", leadId: lead, emailVerified: true, emailMatches: true, linkedToOther: false });
    await t.run(`delete from lead_claim where id = ${q(id)}`);
  });

  it("the database itself refuses an approved claim with no verification method", async () => {
    const id = await claim(claimUser.userId, lead);
    await expect(t.run(`update lead_claim set status = 'approved' where id = ${q(id)}`)).rejects.toThrow(/lead_claim_approval_needs_method/);
    await t.run(`delete from lead_claim where id = ${q(id)}`);
  });

  it("approving without a method is refused by the function and changes nothing", async () => {
    const id = await claim(claimUser.userId, lead);
    const result = await asRuntime(() => decideClaim(t.db, admin, id, { decision: "approve", verificationMethod: undefined as never }));
    expect(result.outcome).toBe("method_required");
    expect(await rows(`select status, verification_method from lead_claim where id = ${q(id)}`)).toEqual([{ status: "pending", verification_method: null }]);
    expect(await rows(`select user_id from lead where id = ${q(lead)}`)).toEqual([{ user_id: null }]);
    await t.run(`delete from lead_claim where id = ${q(id)}`);
  });

  it("'Email matches the lead' is checked against the account's verified email, not trusted", async () => {
    const stranger = await staff("student");
    await t.run(`update neon_auth."user" set email = 'someone-else@example.test' where id = ${q(stranger.userId)}`);
    const id = await claim(stranger.userId, lead);
    expect((await asRuntime(() => decideClaim(t.db, admin, id, { decision: "approve", verificationMethod: "email_match" }))).outcome).toBe("email_mismatch");
    expect(await rows(`select status from lead_claim where id = ${q(id)}`)).toEqual([{ status: "pending" }]);
    // The WhatsApp check is the admin's own word and is accepted.
    expect((await asRuntime(() => decideClaim(t.db, admin, id, { decision: "approve", verificationMethod: "whatsapp_confirmed" }))).outcome).toBe("approved");
    await t.run(`update lead set user_id = null where id = ${q(lead)}`);
  });

  it("approval links the lead, saves the method and who decided, writes a claimed activity and an audit entry that records the method", async () => {
    const id = await claim(claimUser.userId, lead);
    const result = await asRuntime(() => decideClaim(t.db, admin, id, { decision: "approve", verificationMethod: "email_match" }));
    expect(result).toEqual({ outcome: "approved", leadId: lead });
    expect(await rows(`select status, verification_method, decided_by from lead_claim where id = ${q(id)}`)).toEqual([{ status: "approved", verification_method: "email_match", decided_by: admin.userId }]);
    expect(await rows(`select user_id from lead where id = ${q(lead)}`)).toEqual([{ user_id: claimUser.userId }]);
    expect(await count(`select count(*) as n from lead_activity where lead_id = ${q(lead)} and type = 'claimed'`)).toBeGreaterThanOrEqual(1);
    const [audit] = await rows(`select meta from audit_log where action = 'leads.decideClaim' and entity_id = ${q(id)}`);
    expect((audit?.meta as Record<string, unknown>).verification_method).toBe("email_match");
    // Deciding it again is refused.
    expect((await asRuntime(() => decideClaim(t.db, admin2, id, { decision: "reject", reason: "late" }))).outcome).toBe("not_pending");
  });

  it("a lead that belongs to another account cannot be approved for a second one", async () => {
    const second = await staff("student");
    const id = await claim(second.userId, lead);
    expect((await asRuntime(() => decideClaim(t.db, admin, id, { decision: "approve", verificationMethod: "whatsapp_confirmed" }))).outcome).toBe("already_linked");
  });

  it("rejecting keeps the reason and links nothing", async () => {
    const other = await leadRow(t, { name: "Not Theirs", whatsapp_e164: "+237655500002" });
    const id = await claim(claimUser.userId, other, "number");
    const result = await asRuntime(() => decideClaim(t.db, admin, id, { decision: "reject", reason: "Numbers do not match" }));
    expect(result.outcome).toBe("rejected");
    expect(await rows(`select status, reject_reason, decided_by from lead_claim where id = ${q(id)}`)).toEqual([{ status: "rejected", reject_reason: "Numbers do not match", decided_by: admin.userId }]);
    expect(await rows(`select user_id from lead where id = ${q(other)}`)).toEqual([{ user_id: null }]);
  });

  it("a student cannot decide or list claims", async () => {
    await expect(asRuntime(() => decideClaim(t.db, student, uuidv7(), { decision: "reject", reason: "x" }))).rejects.toThrow();
    expect(await asRuntime(() => listPendingClaims(t.db, student))).toEqual([]);
  });
});

describe("S5.5 erasure: all of it or none of it", () => {
  let u: string;
  let target: string;
  let merged: string;
  let ref: string;
  let paymentId: string;

  async function build(): Promise<void> {
    u = await uni(t, { status: "published" });
    ref = "";
    target = await leadRow(t, { name: "Erase Me", email: "erase@example.test", whatsapp_e164: "+237699900001", results: [{ subject: "Maths", grade: "A" }] });
    ref = await refOf(target);
    merged = await leadRow(t, { name: "Erase Me Again", whatsapp_e164: "+237699900001", merged_into_id: target });
    await asRuntime(() => addNote(t.db, admin, { leadId: target, body: "Mother's phone 699 000 000" }));
    await insertRow(t, "event", { id: uuidv7(), type: "wa_tap", lead_ref: ref, lead_id: target });
    await insertRow(t, "event", { id: uuidv7(), type: "wa_tap", lead_ref: ref });
    await insertRow(t, "event", { id: uuidv7(), type: "wa_tap", lead_ref: "SC-ZZZZZ-ZZZZZ" });
    paymentId = await insertRow(t, "placement_payment", { id: uuidv7(), submission_token: randomUUID(), university_id: u, lead_id: target, amount_usd_cents: 50000, received_on: "2026-10-01", entered_by: admin.userId });
  }

  it("without the identity box ticked, nothing is erased", async () => {
    await build();
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: target, identityConfirmed: false }))).toBe("identity_not_confirmed");
    expect(await rows(`select name from lead where id = ${q(target)}`)).toEqual([{ name: "Erase Me" }]);
  });

  it("a failure halfway leaves nothing half-erased", async () => {
    // Make the last step fail from inside the same transaction: any update of a payment row raises.
    await t.run(`create or replace function public.test_block_payment_update() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await t.run(`create trigger test_block_payment_update before update on public.placement_payment for each row execute function public.test_block_payment_update()`);
    try {
      await expect(asRuntime(() => eraseLead(t.db, admin, { leadId: target, identityConfirmed: true }))).rejects.toThrow();
    } finally {
      await t.run(`drop trigger test_block_payment_update on public.placement_payment`);
      await t.run(`drop function public.test_block_payment_update()`);
    }
    expect(await rows(`select name, email, anonymised_at from lead where id = ${q(target)}`)).toEqual([{ name: "Erase Me", email: "erase@example.test", anonymised_at: null }]);
    expect(await count(`select count(*) as n from lead_note where lead_id = ${q(target)} and erased_at is not null`)).toBe(0);
    expect(await count(`select count(*) as n from event where lead_ref = ${q(ref)}`)).toBe(2);
    expect(await count(`select count(*) as n from lead_activity where lead_id = ${q(target)} and type = 'anonymised'`)).toBe(0);
    expect(await count(`select count(*) as n from audit_log where action = 'leads.eraseLead'`)).toBe(0);
  });

  it("erases the lead and what is merged into it, overwrites notes, clears event and payment links, and keeps the history, payments and counts", async () => {
    const activityBefore = await count(`select count(*) as n from lead_activity where lead_id = ${q(target)}`);
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: target, identityConfirmed: true }))).toBe("erased");

    const [erased] = await rows(`select name, whatsapp_e164, email, results, user_id, anonymised_at, ref, country_code from lead where id = ${q(target)}`);
    expect(erased).toMatchObject({ name: null, whatsapp_e164: null, email: null, results: [], user_id: null, ref, country_code: "CM" });
    expect(erased?.anonymised_at).not.toBeNull();
    // The lead that was merged into it is the same person, so it is erased too.
    expect(await rows(`select name, whatsapp_e164 from lead where id = ${q(merged)}`)).toEqual([{ name: null, whatsapp_e164: null }]);

    // Notes: the text is overwritten and the row stays.
    expect(await rows(`select body, erased_at is not null as erased from lead_note where lead_id = ${q(target)}`)).toEqual([{ body: "[erased]", erased: true }]);
    // Events: the reference link is gone for this lead and only this lead; the other reference is untouched.
    expect(await count(`select count(*) as n from event where lead_ref = ${q(ref)} or lead_id = ${q(target)}`)).toBe(0);
    expect(await count(`select count(*) as n from event where lead_ref = 'SC-ZZZZZ-ZZZZZ'`)).toBe(1);
    expect(await count(`select count(*) as n from event where type = 'wa_tap'`)).toBe(3);
    // Payments: the row remains, its lead link is cleared.
    // A bigint comes back as a string from node-postgres and as a number from PGlite, so compare it as a number.
    const [payment] = await rows(`select lead_id, amount_usd_cents from placement_payment where id = ${q(paymentId)}`);
    expect(payment?.lead_id).toBeNull();
    expect(Number(payment?.amount_usd_cents)).toBe(50000);
    // Activity: nothing existing was touched, one `anonymised` entry was added by the admin.
    expect(await count(`select count(*) as n from lead_activity where lead_id = ${q(target)}`)).toBe(activityBefore + 1);
    expect(await rows(`select actor_id from lead_activity where lead_id = ${q(target)} and type = 'anonymised'`)).toEqual([{ actor_id: admin.userId }]);
    expect(await count(`select count(*) as n from audit_log where action = 'leads.eraseLead' and entity_id = ${q(target)}`)).toBe(1);
  });

  it("the audit entry holds no personal data", async () => {
    const [entry] = await rows(`select meta from audit_log where action = 'leads.eraseLead' and entity_id = ${q(target)}`);
    expect(JSON.stringify(entry?.meta)).not.toMatch(/Erase|erase@|699/);
  });

  it("erasing again is refused, and an erased lead drops out of the Overdue and Unassigned views but stays countable by stage", async () => {
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: target, identityConfirmed: true }))).toBe("already_erased");
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: uuidv7(), identityConfirmed: true }))).toBe("not_found");
    const overdue = await asRuntime(() => listLeadsAdmin(t.db, admin, filters({ view: "overdue", now: new Date("2030-01-01T00:00:00Z") })));
    expect(overdue.map((r) => r.id)).not.toContain(target);
    const all = await asRuntime(() => listLeadsAdmin(t.db, admin, filters()));
    expect(all.find((r) => r.id === target)).toMatchObject({ name: null });
  });

  it("a student cannot run an erasure", async () => {
    const other = await leadRow(t, { name: "Safe", whatsapp_e164: "+237699900002" });
    await expect(asRuntime(() => eraseLead(t.db, student, { leadId: other, identityConfirmed: true }))).rejects.toThrow();
    expect(await rows(`select name from lead where id = ${q(other)}`)).toEqual([{ name: "Safe" }]);
  });
});

describe("S5.5 data requests (B5)", () => {
  it("logs a request for a lead by reference, lists it as open, and completes an export by hand", async () => {
    const id = await leadRow(t, { name: "Data Asker", whatsapp_e164: "+237688800001" });
    const ref = await refOf(id);
    const logged = await asRuntime(() => logDataRequest(t.db, admin, { kind: "export", channel: "whatsapp", leadRef: ref }));
    expect(logged.kind).toBe("ok");
    const open = await asRuntime(() => listDataRequests(t.db, admin, "open"));
    const row = open.find((r) => r.leadId === id);
    expect(row).toMatchObject({ kind: "export", channel: "whatsapp", status: "open", leadRef: ref });
    expect(await asRuntime(() => completeDataRequest(t.db, admin2, row?.id as string))).toBe("done");
    expect(await rows(`select status, handled_by from data_request where id = ${q(row?.id)}`)).toEqual([{ status: "done", handled_by: admin2.userId }]);
    expect(await asRuntime(() => completeDataRequest(t.db, admin, row?.id as string))).toBe("not_open");
    expect((await asRuntime(() => listDataRequests(t.db, admin, "open"))).some((r) => r.id === row?.id)).toBe(false);
    expect((await asRuntime(() => listDataRequests(t.db, admin, "all"))).some((r) => r.id === row?.id)).toBe(true);
  });

  it("an unknown reference is refused", async () => {
    expect(await asRuntime(() => logDataRequest(t.db, admin, { kind: "export", channel: "other", leadRef: "SC-AAAAA-AAAAA" }))).toEqual({ kind: "lead_not_found" });
  });

  it("an erasure request is completed by the erasure, which marks it done in the same transaction, and cannot be marked done by hand first", async () => {
    const id = await leadRow(t, { name: "Erase By Request", whatsapp_e164: "+237688800002" });
    const idRef = await refOf(id);
    const logged = await asRuntime(() => logDataRequest(t.db, admin, { kind: "erasure", channel: "whatsapp", leadRef: idRef }));
    expect(logged.kind).toBe("ok");
    const requestId = logged.kind === "ok" ? logged.id : "";
    expect(await asRuntime(() => completeDataRequest(t.db, admin, requestId))).toBe("erase_first");
    // A request for another lead is a mismatch.
    const other = await leadRow(t, { name: "Not This One", whatsapp_e164: "+237688800003" });
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: other, identityConfirmed: true, dataRequestId: requestId }))).toBe("request_mismatch");
    expect(await rows(`select name from lead where id = ${q(other)}`)).toEqual([{ name: "Not This One" }]);
    // The right lead erases it and closes the request.
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: id, identityConfirmed: true, dataRequestId: requestId }))).toBe("erased");
    expect(await rows(`select status, handled_by from data_request where id = ${q(requestId)}`)).toEqual([{ status: "done", handled_by: admin.userId }]);
    expect(await asRuntime(() => logDataRequest(t.db, admin, { kind: "erasure", channel: "other", leadRef: idRef }))).toEqual({ kind: "lead_erased" });
  });

  it("a portal request that names an account is done only when none of the account's leads is left", async () => {
    const owner = await staff("student");
    const l1 = await leadRow(t, { name: "Account Lead One", whatsapp_e164: "+237688800010", user_id: owner.userId });
    const l2 = await leadRow(t, { name: "Account Lead Two", whatsapp_e164: "+237688800011", user_id: owner.userId });
    const requestId = uuidv7();
    await t.run(`insert into data_request (id, kind, user_id, channel, status) values (${q(requestId)}, 'erasure', ${q(owner.userId)}, 'portal', 'open')`);
    const listed = (await asRuntime(() => listDataRequests(t.db, admin, "open"))).find((r) => r.id === requestId);
    expect(listed?.accountLeads.map((l) => l.id).sort()).toEqual([l1, l2].sort());
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: l1, identityConfirmed: true, dataRequestId: requestId }))).toBe("erased");
    expect(await rows(`select status from data_request where id = ${q(requestId)}`)).toEqual([{ status: "open" }]);
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: l2, identityConfirmed: true, dataRequestId: requestId }))).toBe("erased");
    expect(await rows(`select status from data_request where id = ${q(requestId)}`)).toEqual([{ status: "done" }]);
  });

  it("a student cannot log a data request for someone else's lead: they cannot see it", async () => {
    const id = await leadRow(t, { name: "Hidden", whatsapp_e164: "+237688800020" });
    const hiddenRef = await refOf(id);
    const result = await asRuntime(() => logDataRequest(t.db, student, { kind: "export", channel: "whatsapp", leadRef: hiddenRef }));
    expect(result.kind).toBe("lead_not_found");
    expect(await count(`select count(*) as n from data_request where lead_id = ${q(id)}`)).toBe(0);
  });
});
