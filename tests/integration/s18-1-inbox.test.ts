import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/uuid";
import { inboxDataCalls } from "@/modules/inbox/endpoints";
import { staffNotifications } from "@/server/repositories/notifications";
import { mintActor, type Actor } from "@/server/auth/actor";
import { inContext } from "@/server/db/rls";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { createTestDb, type TestDb } from "./helpers/db";
import { appUserRow, applyForProfile, q } from "./helpers/fixtures";

/**
 * S18.1 the Inbox (architecture 24.9): one call gives every section's count and the rows of one. Each section holds exactly the files its rule
 * names, a manager sees only the students assigned to them (row level security), and the Unassigned section is the Admin's.
 */

let t: TestDb;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a response body read in a test

const actor = (userId: string, role: "manager" | "admin"): Actor => mintActor({ userId, sessionId: `s-${userId}`, storedRole: role, role, twoFactorVerifiedAt: role === "admin" ? new Date() : null });
const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => new Date() });

async function inbox(who: Actor, section?: string): Promise<{ status: number; json: Json }> {
  await t.asRuntime();
  try {
    const call = inboxDataCalls(env())["admin/inbox"];
    if (!call) throw new Error("no inbox call");
    const result = await call(who, { token: null, url: new URL(`https://x.test/api/v1/admin/inbox${section ? `?section=${section}` : ""}`) });
    const response = result instanceof Response ? result : Response.json(result);
    return { status: response.status, json: (await response.json()) as Json };
  } finally {
    await t.asOwner();
  }
}

async function onboard(userId: string, manager: string | null): Promise<void> {
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(userId)}, 'student', now())`);
  await t.asRuntime();
  try {
    await inContext(t.db, { userId, role: "student" }, t.db.execute(sql`select out_outcome from public.app_complete_profile('Ada Eze', '+2348031234567', 'NG', 'olevel_alevel', '[]'::jsonb, 'v1', now(), 'student', 'Ada Eze', 'undergraduate', ARRAY['law'], 2027::smallint)`));
  } finally {
    await t.asOwner();
  }
  await t.run(`update student_profile set assigned_manager_id = ${manager === null ? "null" : q(manager)} where user_id = ${q(userId)}`);
}

async function student(userId: string, manager: string | null, lead: Record<string, unknown> = {}): Promise<string> {
  await onboard(userId, manager);
  return applyForProfile(t, userId, { assigned_manager_id: manager, stage_code: "documents", first_response_at: new Date().toISOString(), ...lead });
}

async function doc(studentId: string, kind: string, state: string, ageHours = 1): Promise<void> {
  const id = uuidv7();
  await t.run(
    `insert into student_document (id, student_id, kind, storage_key, content_type, byte_size, state, created_at) values (${q(id)}, ${q(studentId)}, ${q(kind)}, ${q(`${studentId}/${id}`)}, 'application/pdf', 10, ${q(state)}, now() - interval '${ageHours} hours')`,
  );
}

const A = "ib-mgr-a";
const B = "ib-mgr-b";
const ADMIN = "ib-adm";

beforeAll(async () => {
  t = await createTestDb();
  await appUserRow(t, A, "manager");
  await appUserRow(t, B, "manager");
  await appUserRow(t, ADMIN, "admin");
});

afterAll(async () => {
  await t.close();
});

describe("S18.1 the Inbox sections", () => {
  it("New holds files nobody has answered yet, and a reply takes a file out", async () => {
    const fresh = await student("ib-new", A, { first_response_at: null });
    await student("ib-answered", A);
    const result = await inbox(actor(A, "manager"), "new");
    expect(result.status).toBe(200);
    expect(result.json.rows.map((r: { id: string }) => r.id)).toEqual([fresh]);
    await t.run(`update lead set first_response_at = now() where id = ${q(fresh)}`);
    expect((await inbox(actor(A, "manager"), "new")).json.rows).toEqual([]);
  });

  it("To review holds students with uploaded (not pending, approved or rejected) documents, with how many wait", async () => {
    const waiting = await student("ib-rev", A);
    await doc("ib-rev", "results", "uploaded");
    await doc("ib-rev", "id", "uploaded");
    await doc("ib-rev", "birth_certificate", "approved");
    await student("ib-rev-none", A);
    await doc("ib-rev-none", "results", "pending");
    await doc("ib-rev-none", "id", "rejected");
    const result = await inbox(actor(A, "manager"), "to_review");
    expect(result.json.rows).toHaveLength(1);
    expect(result.json.rows[0]).toMatchObject({ id: waiting, waiting: 2 });
    expect(result.json.counts.to_review).toBe(1);
  });

  it("Overdue holds a file at step 3 whose three days have passed, and not one inside them or at another step", async () => {
    const late = await student("ib-late", A, { stage_code: "university_review", university_submitted_at: new Date(Date.now() - 4 * 86_400_000).toISOString() });
    await student("ib-ontime", A, { stage_code: "university_review", university_submitted_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    await student("ib-otherstep", A, { stage_code: "offer_letter", university_submitted_at: new Date(Date.now() - 9 * 86_400_000).toISOString() });
    const result = await inbox(actor(A, "manager"), "overdue");
    expect(result.json.rows.map((r: { id: string }) => r.id)).toEqual([late]);
  });

  it("Letter ready holds a student whose letter has no contact after it, and a reply or an opened WhatsApp clears it", async () => {
    const id = await student("ib-letter", A);
    await doc("ib-letter", "offer_letter", "uploaded", 2);
    expect((await inbox(actor(A, "manager"), "letter_ready")).json.rows.map((r: { id: string }) => r.id)).toEqual([id]);
    await t.run(
      `insert into lead_activity (id, lead_id, type, actor_id, data) values (${q(uuidv7())}, ${q(id)}, 'admin_wa_opened', ${q(A)}, '{}'::jsonb)`,
    );
    expect((await inbox(actor(A, "manager"), "letter_ready")).json.rows).toEqual([]);
    // A letter uploaded after that contact is ready again.
    await doc("ib-letter", "acceptance_letter", "uploaded", 0);
    expect((await inbox(actor(A, "manager"), "letter_ready")).json.rows.map((r: { id: string }) => r.id)).toEqual([id]);
  });

  it("Payment proof holds a proof waiting for approval, not an approved one", async () => {
    const waiting = await student("ib-proof", A);
    await doc("ib-proof", "payment_proof", "uploaded");
    await student("ib-proof-done", A);
    await doc("ib-proof-done", "payment_proof", "approved");
    const result = await inbox(actor(A, "manager"), "payment_proof");
    expect(result.json.rows.map((r: { id: string }) => r.id)).toEqual([waiting]);
  });

  it("Quiet holds an open file with no student action for 14 days, with the days idle, and a closed file is never in it", async () => {
    const quiet = await student("ib-quiet", A);
    await t.run(`update lead set last_student_activity_at = now() - interval '20 days' where id = ${q(quiet)}`);
    const closed = await student("ib-quiet-closed", A);
    await t.run(`update lead set last_student_activity_at = now() - interval '60 days', status = 'closed', closed_reason = 'no_response', closed_at = now() where id = ${q(closed)}`);
    await student("ib-recent", A);
    const result = await inbox(actor(A, "manager"), "quiet");
    expect(result.json.rows).toHaveLength(1);
    expect(result.json.rows[0]).toMatchObject({ id: quiet, idleDays: 20 });
  });
});

describe("S18.1 who sees what", () => {
  it("a manager sees only the students assigned to them, in the counts as well as the rows", async () => {
    const mine = await student("ib-scope-a", A, { first_response_at: null });
    const theirs = await student("ib-scope-b", B, { first_response_at: null });
    const a = await inbox(actor(A, "manager"), "new");
    const b = await inbox(actor(B, "manager"), "new");
    expect(a.json.rows.map((r: { id: string }) => r.id)).toContain(mine);
    expect(a.json.rows.map((r: { id: string }) => r.id)).not.toContain(theirs);
    expect(b.json.rows.map((r: { id: string }) => r.id)).toContain(theirs);
    expect(b.json.rows.map((r: { id: string }) => r.id)).not.toContain(mine);
    expect(a.json.counts.new).toBe(a.json.rows.length);
  });

  it("the Admin sees every student, and Unassigned is the Admin's own section", async () => {
    const orphan = await student("ib-orphan", null, { first_response_at: null });
    const admin = await inbox(actor(ADMIN, "admin"), "unassigned");
    expect(admin.json.section).toBe("unassigned");
    expect(admin.json.rows.map((r: { id: string }) => r.id)).toContain(orphan);
    const all = await inbox(actor(ADMIN, "admin"), "new");
    expect(all.json.rows.length).toBeGreaterThan((await inbox(actor(A, "manager"), "new")).json.rows.length);

    const manager = await inbox(actor(A, "manager"), "unassigned");
    expect(manager.json.section).toBe("new"); // not a section a manager has
    expect(manager.json.counts.unassigned).toBe(0);
    expect(manager.json.rows.map((r: { id: string }) => r.id)).not.toContain(orphan);
  });

  it("an unknown section is a validation error, and the default is New", async () => {
    expect((await inbox(actor(A, "manager"), "nonsense")).status).toBe(400);
    expect((await inbox(actor(A, "manager"))).json.section).toBe("new");
  });

  it("a section with more than 50 files says so and returns 50", async () => {
    await t.run(`delete from lead where user_id like 'ib-cap-%'`);
    for (let i = 0; i < 52; i += 1) await student(`ib-cap-${i}`, B, { first_response_at: null });
    const result = await inbox(actor(B, "manager"), "new");
    expect(result.json.rows).toHaveLength(50);
    expect(result.json.more).toBe(true);
    expect(result.json.counts.new).toBeGreaterThanOrEqual(52);
  });
});

describe("S18.1 alerts (architecture 24.10)", () => {
  const alertsOf = async (who: Actor) => {
    await t.asRuntime();
    try {
      return await staffNotifications(t.db, who, new Date());
    } finally {
      await t.asOwner();
    }
  };

  it("a manager is alerted to documents waiting, a letter, proof of payment and an overdue file, for their own students only", async () => {
    const own = await student("al-own", A, { stage_code: "university_review", university_submitted_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    await doc("al-own", "results", "uploaded");
    await doc("al-own", "offer_letter", "uploaded");
    await doc("al-own", "payment_proof", "uploaded");
    const other = await student("al-other", B);
    await doc("al-other", "results", "uploaded");

    const mine = await alertsOf(actor(A, "manager"));
    // (`new_lead` is the older alert for a file nobody has opened; these four are the version 5 ones.)
    const kinds = mine.items.filter((i) => i.leadId === own && i.kind !== "new_lead").map((i) => i.kind).sort();
    expect(kinds).toEqual(["docs_review", "letter_ready", "overdue", "proof_waiting"]);
    expect(mine.items.some((i) => i.leadId === other)).toBe(false);
    expect(mine.items.find((i) => i.leadId === own && i.kind === "docs_review")?.count).toBe(1);
    expect(mine.items.every((i) => i.unread)).toBe(true);
    expect(mine.unread).toBe(mine.items.length);
  });

  it("the Admin is also told about a student with no manager, and a manager never is", async () => {
    const orphan = await student("al-orphan", null);
    const admin = await alertsOf(actor(ADMIN, "admin"));
    expect(admin.items.some((i) => i.kind === "unassigned" && i.leadId === orphan)).toBe(true);
    const manager = await alertsOf(actor(A, "manager"));
    expect(manager.items.some((i) => i.kind === "unassigned")).toBe(false);
  });

  it("a reviewed document, a contacted letter and an answered proof stop alerting", async () => {
    const id = await student("al-clear", A);
    await doc("al-clear", "results", "approved");
    await doc("al-clear", "payment_proof", "approved");
    await doc("al-clear", "offer_letter", "uploaded", 3);
    await t.run(`insert into lead_activity (id, lead_id, type, actor_id, data) values (${q(uuidv7())}, ${q(id)}, 'reply_logged', ${q(A)}, '{}'::jsonb)`);
    const kinds = (await alertsOf(actor(A, "manager"))).items.filter((i) => i.leadId === id && i.kind !== "new_lead").map((i) => i.kind);
    expect(kinds).toEqual([]);
  });
});
