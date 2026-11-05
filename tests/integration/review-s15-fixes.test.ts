import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, mintActor } from "@/server/auth/actor";
import { funnelData } from "@/server/repositories/analytics";
import { eraseLead, listLeadsPage } from "@/server/repositories/lead-admin";
import { eraseMyAccount } from "@/server/repositories/student";
import { createTestDb, type TestDb } from "./helpers/db";
import { leadRow, programmeRow, q, uni } from "./helpers/fixtures";

/**
 * The code review of Stage 0 to S15.7, against a real database as the non-owner runtime role (ADR-038):
 *  - erasing a lead (by an admin, by the student, or any later way) leaves no contact name in `lead.source` (migration 0021);
 *  - a lead that chose a university's programmes, with no university in its source, counts under that university in Insights and in the
 *    Leads list filter, with the same rule (`lead-filters.ts`).
 */

let t: TestDb;
let admin: Actor;
let universityA = "";
let universityB = "";
let programmeA = "";
let programmeB = "";

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

async function sourceOf(id: string): Promise<Record<string, unknown> | null> {
  const [row] = (await t.run(`select source from lead where id = ${q(id)}`)) as { source: Record<string, unknown> | null }[];
  return row?.source ?? null;
}

beforeAll(async () => {
  t = await createTestDb();
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(user.userId)}, 'admin', now())`);
  admin = mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: "admin", role: "admin", twoFactorVerifiedAt: null });
  universityA = await uni(t, { name: "Alpha University" });
  universityB = await uni(t, { name: "Beta University" });
  programmeA = await programmeRow(t, universityA);
  programmeB = await programmeRow(t, universityB);
});

afterAll(async () => {
  await t.close();
});

describe("erasing a lead keeps no contact name", () => {
  // Dated long ago, so these leads are outside the Insights range of the next group.
  const OLD = { received_at: "2020-01-01T00:00:00Z" };
  const SOURCE = { page: "apply", contact_name: "Parent Name", relationship: "parent", course_fields: ["law"] };

  it("scrubs the name when an admin erases the lead, and keeps the rest of the source", async () => {
    const id = await leadRow(t, { ...OLD, source: SOURCE });
    expect(await asRuntime(() => eraseLead(t.db, admin, { leadId: id, identityConfirmed: true }))).toBe("erased");
    expect(await sourceOf(id)).toEqual({ page: "apply", relationship: "parent", course_fields: ["law"] });
  });

  it("scrubs the name when the student erases their own account", async () => {
    const student = await t.signIn();
    await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(student.userId)}, 'student', now())`);
    const id = await leadRow(t, { ...OLD, source: SOURCE, user_id: student.userId });
    const actor = mintActor({ userId: student.userId, sessionId: student.sessionId, storedRole: "student", role: "student", twoFactorVerifiedAt: null });
    await asRuntime(() => eraseMyAccount(t.db, actor, student.token));
    expect(await sourceOf(id)).toEqual({ page: "apply", relationship: "parent", course_fields: ["law"] });
  });

  it("leaves the name on a lead that is not erased", async () => {
    const id = await leadRow(t, { ...OLD, source: SOURCE });
    await t.run(`update lead set last_activity_at = now() where id = ${q(id)}`);
    expect((await sourceOf(id))?.contact_name).toBe("Parent Name");
  });
});

describe("a lead counts under the universities whose programmes it chose", () => {
  const range = () => {
    const now = Date.now();
    const day = (n: number) => new Date(now + n * 86_400_000);
    return { from: day(-3).toISOString().slice(0, 10), to: day(1).toISOString().slice(0, 10), start: day(-3), end: day(1) };
  };
  let both = "";
  let onlyA = "";
  let none = "";

  beforeAll(async () => {
    both = await leadRow(t, { source: { page: "apply" } });
    onlyA = await leadRow(t, { source: { page: "apply" } });
    none = await leadRow(t, { source: {} });
    await t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(both)}, ${q(programmeA)}, 1)`);
    await t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(both)}, ${q(programmeB)}, 2)`);
    await t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(onlyA)}, ${q(programmeA)}, 1)`);
  });

  it("counts each lead once under every university it chose, and a lead that chose none in one row with no university", async () => {
    const data = await asRuntime(() => funnelData(t.db, admin, range()));
    const count = (id: string | null) => data.byUniversity.find((r) => r.universityId === id)?.leads;
    expect(count(universityA)).toBe(2);
    expect(count(universityB)).toBe(1);
    expect(count(null)).toBe(1);
  });

  it("filters Insights by a university the same way", async () => {
    const data = await asRuntime(() => funnelData(t.db, admin, { ...range(), universityId: universityB }));
    expect([...data.leadsByStage.values()].reduce((a, b) => a + b, 0)).toBe(1);
    expect(data.byUniversity).toEqual([expect.objectContaining({ universityId: universityB, leads: 1 })]);
  });

  it("filters the Leads list by a university the same way", async () => {
    const page = await asRuntime(() => listLeadsPage(t.db, admin, { view: "all", universityId: universityA, limit: 50, now: new Date() }));
    expect(page.rows.map((r) => r.id).sort()).toEqual([both, onlyA].sort());
    expect(none).not.toBe("");
  });
});
