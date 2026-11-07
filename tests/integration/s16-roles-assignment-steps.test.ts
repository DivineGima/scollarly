import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mintActor, type Actor } from "@/server/auth/actor";
import { type RlsContext, inContext } from "@/server/db/rls";
import { rowsOf } from "@/server/db/rows";
import { changeStage, closeLead, moveBack, reopenLead } from "@/server/repositories/lead-admin";
import { reassignManager, setStaffSettings } from "@/server/repositories/team";
import { createTestDb, type TestDb } from "./helpers/db";
import { appUserRow, leadRow, q } from "./helpers/fixtures";

/**
 * Stage 16 (version 5; architecture 24.2 to 24.4): the roles, the assignment of a student to a manager, and the seven steps with the rules for
 * moving a file. Every call runs as the non-owner runtime role, so row level security is in force (ADR-038).
 */

let t: TestDb;

const ctx = (userId: string, role: RlsContext["role"]): RlsContext => ({ userId, role });
const actor = (userId: string, role: "student" | "manager" | "admin"): Actor =>
  mintActor({ userId, sessionId: `s-${userId}`, storedRole: role, role, twoFactorVerifiedAt: role === "admin" ? new Date() : null });

async function as(context: RlsContext, statement: string): Promise<Record<string, unknown>[]> {
  await t.asRuntime();
  try {
    const [result] = await inContext(t.db, context, t.db.execute(sql.raw(statement)));
    return rowsOf<Record<string, unknown>>(result);
  } finally {
    await t.asOwner();
  }
}

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

async function reasonOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    let current: unknown = error;
    while (current instanceof Error && current.cause instanceof Error) current = current.cause;
    return current instanceof Error ? current.message : String(current);
  }
  return "";
}

const rows = (statement: string) => t.run(statement) as Promise<Record<string, unknown>[]>;
const one = async (statement: string) => (await rows(statement))[0];
const versionOf = async (id: string) =>
  String((await one(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as v from lead where id = ${q(id)}`))?.v);

const change = async (who: Actor, leadId: string, stage: string) => {
  const version = await versionOf(leadId);
  return asRuntime(() => changeStage(t.db, who, { leadId, stage, version }));
};
const back = async (who: Actor, leadId: string, note: string) => {
  const version = await versionOf(leadId);
  return asRuntime(() => moveBack(t.db, who, { leadId, version, note }));
};
const close = async (who: Actor, leadId: string, reason: "no_response" | "refused" | "withdrew" | "other") => {
  const version = await versionOf(leadId);
  return asRuntime(() => closeLead(t.db, who, { leadId, version, reason }));
};
const reopen = async (who: Actor, leadId: string) => {
  const version = await versionOf(leadId);
  return asRuntime(() => reopenLead(t.db, who, { leadId, version }));
};

/** Finishes a student's onboarding as the student, through the database function the Worker calls. */
async function onboard(userId: string): Promise<string> {
  const result = await as(
    ctx(userId, "student"),
    `select out_outcome from public.app_complete_profile('Ada Eze', '+2348031234567', 'NG', 'olevel_alevel', '[]'::jsonb, 'v1', now(), 'student', 'Ada Eze', 'undergraduate', ARRAY['law'], 2027::smallint)`,
  );
  return String(result[0]?.out_outcome);
}

const managerOfProfile = async (userId: string): Promise<string | null> => ((await one(`select assigned_manager_id as m from student_profile where user_id = ${q(userId)}`))?.m as string | null | undefined) ?? null;

async function student(id: string): Promise<string> {
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(id)}, 'student', now())`);
  return id;
}

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

describe("S16.1 roles: at most two admins, and an invite names the role it creates", () => {
  // Its own database: an admin's role is permanent, and the other groups need their admins to themselves.
  let u: TestDb;
  const uone = async (statement: string) => ((await u.run(statement)) as Record<string, unknown>[])[0];
  beforeAll(async () => {
    u = await createTestDb();
  });
  afterAll(async () => {
    await u.close();
  });

  it("an accepted invite makes the manager, a second admin is allowed, a third is refused as an invalid invite", async () => {
    const accept = async (email: string, role: "manager" | "admin") => {
      const user = await u.signIn({ email });
      await u.run(`insert into admin_invite (id, email, token_hash, invited_by, expires_at, role) values (gen_random_uuid(), ${q(email)}, ${q(`h-${email}`)}, 'x', now() + interval '1 day', ${q(role)})`);
      const result = await uone(`select public.app_accept_invite(${q(user.token)}, ${q(`h-${email}`)}) as r`);
      return { userId: user.userId, result: result?.r };
    };
    const manager = await accept("m@example.test", "manager");
    expect(manager.result).toBe("accepted");
    expect((await uone(`select role from app_user where id = ${q(manager.userId)}`))?.role).toBe("manager");

    const admin1 = await accept("a1@example.test", "admin");
    const admin2 = await accept("a2@example.test", "admin");
    expect([admin1.result, admin2.result]).toEqual(["accepted", "accepted"]);
    const third = await accept("a3@example.test", "admin");
    expect(third.result).toBe("invalid");
    expect((await uone(`select count(*)::int as n from app_user where role = 'admin'`))?.n).toBe(2);
    expect((await uone(`select role from app_user where id = ${q(third.userId)}`))?.role).toBe("student"); // nothing was changed for them
  });

  it("an invite names only a manager or an admin", async () => {
    await expect(u.run(`insert into admin_invite (id, email, token_hash, invited_by, expires_at, role) values (gen_random_uuid(), 'z@example.test', 'hz', 'x', now() + interval '1 day', 'owner')`)).rejects.toThrow();
  });
});

describe("S16.2 assignment (architecture 24.3)", () => {
  const ids = { m1: "mgr-1", m2: "mgr-2", m3: "mgr-3", admin: "adm-a" };

  beforeAll(async () => {
    for (const id of [ids.m1, ids.m2, ids.m3]) await appUserRow(t, id, "manager");
    await t.run(`update app_user set created_at = now() - interval '3 days' where id = ${q(ids.m1)}`);
    await t.run(`update app_user set created_at = now() - interval '2 days' where id = ${q(ids.m2)}`);
    await t.run(`update app_user set created_at = now() - interval '1 day' where id = ${q(ids.m3)}`);
    await appUserRow(t, ids.admin, "admin");
    await t.run(`update app_user set away = true where id = ${q(ids.m2)}`);
  });

  it("gives each new student the next manager in turn, skips a manager who is away, and a replay takes no turn", async () => {
    const given: (string | null)[] = [];
    for (const n of [1, 2, 3, 4]) {
      const id = await student(`stu-turn-${n}`);
      expect(await onboard(id)).toBe("created");
      given.push(await managerOfProfile(id));
    }
    // m1 is the oldest, then m3 (m2 is away), then m1 again (longest since), then m3.
    expect(given).toEqual([ids.m1, ids.m3, ids.m1, ids.m3]);

    const before = await one(`select last_assigned_at as at from app_user where id = ${q(ids.m1)}`);
    expect(await onboard("stu-turn-1")).toBe("already_onboarded");
    expect(await managerOfProfile("stu-turn-1")).toBe(ids.m1);
    expect((await one(`select last_assigned_at as at from app_user where id = ${q(ids.m1)}`))?.at).toEqual(before?.at);
  });

  it("an away manager keeps the students they have and takes new ones again when back", async () => {
    expect(await managerOfProfile("stu-turn-1")).toBe(ids.m1);
    await t.run(`update app_user set away = false where id = ${q(ids.m2)}`);
    const id = await student("stu-back");
    await onboard(id);
    expect(await managerOfProfile(id)).toBe(ids.m2); // never had a student: first in line
  });

  it("with nobody available the student has no manager, and only an admin can see them", async () => {
    await t.run(`update app_user set away = true where role = 'manager'`);
    const id = await student("stu-nobody");
    expect(await onboard(id)).toBe("created");
    expect(await managerOfProfile(id)).toBeNull();
    expect((await as(ctx(ids.m1, "manager"), `select 1 from student_profile where user_id = 'stu-nobody'`)).length).toBe(0);
    expect((await as(ctx(ids.admin, "admin"), `select 1 from student_profile where user_id = 'stu-nobody'`)).length).toBe(1);
    await t.run(`update app_user set away = false where role = 'manager'`);
  });

  it("two sign-ups at the same moment take turns (the advisory lock serialises them)", async () => {
    const a = await student("stu-race-a");
    const b = await student("stu-race-b");
    // The test database has one connection, so the two run one after the other; what is proved is that each takes exactly one turn.
    const before = (await rows(`select id, last_assigned_at from app_user where role = 'manager'`)).length;
    await onboard(a);
    await onboard(b);
    const got = [await managerOfProfile(a), await managerOfProfile(b)];
    expect(got[0]).not.toBeNull();
    expect(got[1]).not.toBeNull();
    expect(got[0]).not.toBe(got[1]);
    expect(before).toBe(3);
  });

  it("only an admin moves a student, and only to a manager", async () => {
    const id = "stu-turn-2"; // m3's student
    await leadRow(t, { user_id: id, assigned_manager_id: ids.m3, status: "open" });
    expect(await reasonOf(asRuntime(() => reassignManager(t.db, actor(ids.m3, "manager"), id, ids.m1)))).toMatch(/Only an admin can move a student/);

    expect(await asRuntime(() => reassignManager(t.db, actor(ids.admin, "admin"), id, "stu-turn-1"))).toBe("not_a_manager");
    expect(await asRuntime(() => reassignManager(t.db, actor(ids.admin, "admin"), "nobody-at-all", ids.m1))).toBe("no_student");
    expect(await asRuntime(() => reassignManager(t.db, actor(ids.admin, "admin"), id, ids.m3))).toBe("unchanged");
    expect(await asRuntime(() => reassignManager(t.db, actor(ids.admin, "admin"), id, ids.m1))).toBe("moved");

    expect(await managerOfProfile(id)).toBe(ids.m1);
    expect((await one(`select assigned_manager_id as m from lead where user_id = ${q(id)}`))?.m).toBe(ids.m1);
    expect((await one(`select count(*)::int as n from lead_activity where type = 'assigned' and data->>'reason' = 'reassigned'`))?.n).toBe(1);
    expect((await one(`select count(*)::int as n from audit_log where action = 'student.reassign' and entity_id = ${q(id)}`))?.n).toBe(1);

    // The old manager no longer sees the student's file, the new one does.
    expect((await as(ctx(ids.m3, "manager"), `select 1 from lead where user_id = ${q(id)}`)).length).toBe(0);
    expect((await as(ctx(ids.m1, "manager"), `select 1 from lead where user_id = ${q(id)}`)).length).toBe(1);
    // And back to nobody.
    expect(await asRuntime(() => reassignManager(t.db, actor(ids.admin, "admin"), id, null))).toBe("moved");
    expect(await managerOfProfile(id)).toBeNull();
  });

  it("a manager sets their own away switch and number; a bad number is refused; a student cannot", async () => {
    expect(await asRuntime(() => setStaffSettings(t.db, actor(ids.m1, "manager"), { away: true, whatsapp: "+237612345678" }))).toBe(true);
    expect(await one(`select away, whatsapp_number from app_user where id = ${q(ids.m1)}`)).toEqual({ away: true, whatsapp_number: "+237612345678" });
    // Only the switch: the number stays.
    expect(await asRuntime(() => setStaffSettings(t.db, actor(ids.m1, "manager"), { away: false }))).toBe(true);
    expect(await one(`select away, whatsapp_number from app_user where id = ${q(ids.m1)}`)).toEqual({ away: false, whatsapp_number: "+237612345678" });
    // null clears the number.
    expect(await asRuntime(() => setStaffSettings(t.db, actor(ids.m1, "manager"), { whatsapp: null }))).toBe(true);
    expect((await one(`select whatsapp_number from app_user where id = ${q(ids.m1)}`))?.whatsapp_number).toBeNull();
    expect(await asRuntime(() => setStaffSettings(t.db, actor(ids.m1, "manager"), { whatsapp: "0612345678" }))).toBe(false);
    expect(await reasonOf(asRuntime(() => setStaffSettings(t.db, actor("stu-turn-1", "student"), { away: true })))).toMatch(/Staff only/);
    // The check constraint is the last lock.
    await expect(t.run(`update app_user set whatsapp_number = 'abc' where id = ${q(ids.m1)}`)).rejects.toThrow(/app_user_whatsapp_format/);
  });

  it("a student reads only their own manager's number, and nothing else about the manager", async () => {
    await t.run(`update app_user set whatsapp_number = '+237699999999' where id = ${q(ids.m3)}`);
    await t.run(`update student_profile set assigned_manager_id = ${q(ids.m3)} where user_id = 'stu-turn-4'`);
    expect((await as(ctx("stu-turn-4", "student"), `select public.app_my_manager_whatsapp() as n`))[0]?.n).toBe("+237699999999");
    // A student with no manager, and an anonymous caller, get null.
    await t.run(`update student_profile set assigned_manager_id = null where user_id = 'stu-turn-3'`);
    expect((await as(ctx("stu-turn-3", "student"), `select public.app_my_manager_whatsapp() as n`))[0]?.n).toBeNull();
    // A manager's row is still unreadable to a student.
    expect((await as(ctx("stu-turn-4", "student"), `select 1 from app_user where id = ${q(ids.m3)}`)).length).toBe(0);
  });

  it("removing a manager gives their students back to the admin and ends their sessions", async () => {
    await t.run(`update student_profile set assigned_manager_id = ${q(ids.m3)} where user_id in ('stu-turn-2', 'stu-turn-4')`);
    const lead = await leadRow(t, { user_id: "stu-turn-4", assigned_manager_id: ids.m3 });
    const released = await asRuntime(async () => {
      await t.run(`select set_config('app.user_id', ${q(ids.admin)}, false), set_config('app.role', 'admin', false)`);
      try {
        return (await t.run(`select public.app_remove_manager(${q(ids.m3)}) as n`)) as { n: number }[];
      } finally {
        await t.run(`select set_config('app.user_id', '', false), set_config('app.role', '', false)`);
      }
    });
    expect(released[0]?.n).toBe(1);
    expect(await managerOfProfile("stu-turn-4")).toBeNull();
    expect(await managerOfProfile("stu-turn-2")).toBeNull();
    expect((await one(`select assigned_manager_id as m, status from lead where id = ${q(lead)}`))?.m).toBeNull();
    expect((await one(`select role from app_user where id = ${q(ids.m3)}`))?.role).toBe("student");
  });
});

describe("S16.3 the seven steps and who may move a file (architecture 24.4)", () => {
  const mgr = "mgr-steps";
  const other = "mgr-other";
  const adm = "adm-steps";
  const manager = () => actor(mgr, "manager");
  const admin = () => actor(adm, "admin");
  let id = "";

  beforeAll(async () => {
    await appUserRow(t, mgr, "manager");
    await appUserRow(t, other, "manager");
    await appUserRow(t, adm, "admin");
  });

  const fresh = async (over: Record<string, unknown> = {}) => {
    id = await leadRow(t, { assigned_manager_id: mgr, ...over });
    return id;
  };
  const stageOf = async (leadId: string) => String((await one(`select stage_code from lead where id = ${q(leadId)}`))?.stage_code);

  it("a new file starts at Course interest, open", async () => {
    const lead = await fresh();
    expect(await one(`select stage_code, status, closed_at, arrived_at, university_submitted_at from lead where id = ${q(lead)}`)).toEqual({
      stage_code: "course_interest",
      status: "open",
      closed_at: null,
      arrived_at: null,
      university_submitted_at: null,
    });
    expect(await one(`select last_student_activity_at is not null as ok from lead where id = ${q(lead)}`)).toEqual({ ok: true });
  });

  it("a manager moves their file one step at a time, and not two at once", async () => {
    const lead = await fresh();
    expect(await change(manager(), lead, "offer_letter")).toMatchObject({ kind: "not_allowed", reason: "not_allowed" });
    expect(await stageOf(lead)).toBe("course_interest");
    expect(await change(manager(), lead, "documents")).toMatchObject({ kind: "ok", from: "course_interest" });
    expect(await stageOf(lead)).toBe("documents");
  });

  it("an admin may skip ahead", async () => {
    const lead = await fresh();
    expect(await change(admin(), lead, "registration")).toMatchObject({ kind: "ok" });
    expect(await stageOf(lead)).toBe("registration");
  });

  it("nobody moves a file backwards through changeStage, and a manager cannot touch another manager's file", async () => {
    const lead = await fresh({ stage_code: "visa" });
    expect(await change(admin(), lead, "documents")).toMatchObject({ kind: "not_allowed" });
    expect(await asRuntime(async () => changeStage(t.db, actor(other, "manager"), { leadId: lead, stage: "arrived", version: await versionOf(lead) }))).toEqual({ kind: "not_found" });
    expect(await stageOf(lead)).toBe("visa");
  });

  it("an unknown step is refused and a stale version reports a conflict, writing nothing", async () => {
    const lead = await fresh();
    const version = await versionOf(lead);
    expect(await asRuntime(() => changeStage(t.db, manager(), { leadId: lead, stage: "nope", version }))).toEqual({ kind: "unknown_stage" });
    expect(await asRuntime(() => changeStage(t.db, manager(), { leadId: lead, stage: "documents", version: "2020-01-01T00:00:00.000000Z" }))).toMatchObject({ kind: "conflict" });
    expect(await stageOf(lead)).toBe("course_interest");
    expect((await one(`select count(*)::int as n from lead_activity where lead_id = ${q(lead)} and type = 'stage_changed'`))?.n).toBe(0);
  });

  it("two taps on the same move: one wins, the other is told it already moved", async () => {
    const lead = await fresh();
    const version = await versionOf(lead);
    const first = await asRuntime(() => changeStage(t.db, manager(), { leadId: lead, stage: "documents", version }));
    const second = await asRuntime(() => changeStage(t.db, manager(), { leadId: lead, stage: "documents", version }));
    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("unchanged");
    expect((await one(`select count(*)::int as n from lead_activity where lead_id = ${q(lead)} and type = 'stage_changed'`))?.n).toBe(1);
  });

  it("sending the file to the university starts the three-day clock; arriving closes the open slot and records the day", async () => {
    // A manager leaves step 2 only with the documents approved (S17.1, `s17-1-documents.test.ts`); an admin may put a file on.
    const lead = await fresh({ stage_code: "documents" });
    await change(admin(), lead, "university_review");
    expect((await one(`select university_submitted_at is not null as ok from lead where id = ${q(lead)}`))?.ok).toBe(true);

    const last = await fresh({ stage_code: "visa" });
    await change(manager(), last, "arrived");
    expect(await one(`select status, arrived_at is not null as day from lead where id = ${q(last)}`)).toEqual({ status: "arrived", day: true });
    // An arrived file is finished: the manager cannot move it, only an admin can put it back.
    expect(await change(manager(), last, "documents")).toMatchObject({ kind: "not_allowed" });
  });

  it("only an admin puts a file back one step, with a note; the note is a lead note and the history holds only its id", async () => {
    const lead = await fresh({ stage_code: "registration" });
    const version = await versionOf(lead);
    expect(await asRuntime(() => moveBack(t.db, manager(), { leadId: lead, version, note: "wrong tap" }))).toMatchObject({ kind: "not_allowed" });
    expect(await asRuntime(() => moveBack(t.db, admin(), { leadId: lead, version, note: "   " }))).toMatchObject({ kind: "not_allowed", reason: "note_required" });
    const result = await asRuntime(() => moveBack(t.db, admin(), { leadId: lead, version, note: "Offer was not final" }));
    expect(result).toMatchObject({ kind: "ok", from: "registration", to: "offer_letter" });
    expect(await stageOf(lead)).toBe("offer_letter");
    const note = await one(`select body, author_id from lead_note where lead_id = ${q(lead)}`);
    expect(note).toEqual({ body: "Offer was not final", author_id: adm });
    const activity = await one(`select data from lead_activity where lead_id = ${q(lead)} and type = 'stage_changed'`);
    expect(Object.keys(activity?.data as object).sort()).toEqual(["back", "from", "note_id", "to"]);
    expect(JSON.stringify(activity?.data)).not.toContain("Offer was not final");
    expect((await one(`select count(*)::int as n from audit_log where action = 'leads.moveBack' and entity_id = ${q(lead)}`))?.n).toBe(1);
  });

  it("putting an arrived file back opens it again and clears the day; the first step has nothing before it", async () => {
    const lead = await fresh({ stage_code: "arrived", status: "arrived", arrived_at: new Date().toISOString() });
    await back(admin(), lead, "Not yet landed");
    expect(await one(`select stage_code, status, arrived_at from lead where id = ${q(lead)}`)).toEqual({ stage_code: "visa", status: "open", arrived_at: null });
    const first = await fresh();
    expect(await back(admin(), first, "x")).toMatchObject({ kind: "not_allowed" });
  });

  it("only an admin closes a file, with a reason code; it is then read-only until reopened", async () => {
    const lead = await fresh({ stage_code: "documents" });
    expect(await close(manager(), lead, "refused")).toMatchObject({ kind: "not_allowed" });
    expect(await close(admin(), lead, "refused")).toMatchObject({ kind: "ok" });
    expect(await one(`select status, closed_reason, closed_at is not null as at from lead where id = ${q(lead)}`)).toEqual({ status: "closed", closed_reason: "refused", at: true });
    expect(await change(manager(), lead, "university_review")).toMatchObject({ kind: "not_allowed" });
    expect(await back(admin(), lead, "x")).toMatchObject({ kind: "not_allowed" });
    expect(await reopen(manager(), lead)).toMatchObject({ kind: "not_allowed" });
    expect(await reopen(admin(), lead)).toMatchObject({ kind: "ok" });
    expect(await one(`select status, closed_reason, closed_at from lead where id = ${q(lead)}`)).toEqual({ status: "open", closed_reason: null, closed_at: null });
    expect((await rows(`select type from lead_activity where lead_id = ${q(lead)} order by created_at`)).map((r) => r.type)).toEqual(["closed", "reopened"]);
  });

  it("an account has one open file: a closed one does not block a new one, and reopening is refused while another is open", async () => {
    await student("stu-two-files");
    const first = await leadRow(t, { user_id: "stu-two-files", assigned_manager_id: mgr });
    await expect(leadRow(t, { user_id: "stu-two-files", assigned_manager_id: mgr })).rejects.toThrow(/lead_one_open_per_user/);
    await close(admin(), first, "withdrew");
    const second = await leadRow(t, { user_id: "stu-two-files", assigned_manager_id: mgr });
    expect(second).not.toBe(first);
    // The first file cannot be opened again while the second is open; nothing changes.
    expect(await reopen(admin(), first)).toMatchObject({ kind: "not_allowed" });
    expect((await one(`select status from lead where id = ${q(first)}`))?.status).toBe("closed");
  });

  it("a merged or erased file cannot be moved", async () => {
    const lead = await fresh();
    await t.run(`update lead set merged_into_id = ${q(await leadRow(t))} where id = ${q(lead)}`);
    expect(await change(manager(), lead, "documents")).toEqual({ kind: "unavailable" });
  });
});
