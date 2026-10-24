import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/uuid";
import { ANONYMOUS, inContext, type RlsContext } from "@/server/db/rls";
import { rowsOf } from "@/server/db/rows";
import { appUserRow, consent, insertRow, leadRow, paymentRow, programmeRow, q, uni } from "./helpers/fixtures";
import { createTestDb, type TestDb } from "./helpers/db";

/**
 * ADR-038 / S1.1: row level security, table by table, as the role the Worker uses. The seed below puts known rows in
 * every table; each role must then see exactly the rows its policies allow. A table with no row here fails the
 * every-table check at the end, so a new table cannot be added without deciding who may see it.
 */

let t: TestDb;
const anonymous: RlsContext = ANONYMOUS;
const student: RlsContext = { userId: "stu-1", role: "student" };
const otherStudent: RlsContext = { userId: "stu-2", role: "student" };
const admin: RlsContext = { userId: "adm-1", role: "admin" };
const owner: RlsContext = { userId: "own-1", role: "owner" };
/** An owner whose session has not passed 2FA is given the student role by the facade (architecture 9.3). */
const ownerWithout2fa: RlsContext = { userId: "own-1", role: "student" };

/** Runs one statement as the runtime role with the given context, like `runAs` does for a repository. */
async function as(ctx: RlsContext, statement: string): Promise<Record<string, unknown>[]> {
  await t.asRuntime();
  try {
    const [result] = await inContext(t.db, ctx, t.db.execute(sql.raw(statement)));
    return rowsOf<Record<string, unknown>>(result);
  } finally {
    await t.asOwner();
  }
}

/** Drizzle wraps the Postgres error ("Failed query: ..."); the reason is on the innermost `cause`. */
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

const DENIED = /row-level security|permission denied/;
async function expectDenied(attempt: Promise<unknown>): Promise<void> {
  expect(await reasonOf(attempt)).toMatch(DENIED);
}

const visible = async (ctx: RlsContext, table: string): Promise<number> => Number((await as(ctx, `select count(*)::int as n from ${table}`))[0]?.n);

const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestDb();
  await appUserRow(t, "stu-1");
  await appUserRow(t, "stu-2");
  await appUserRow(t, "adm-1", "admin");
  await appUserRow(t, "own-1", "owner");

  // Public content: one published and one draft row in each content table.
  const universityPublished = await uni(t, { slug: "pub-uni", status: "published" });
  const universityDraft = await uni(t, { slug: "draft-uni", status: "draft" });
  ids.universityPublished = universityPublished;
  const pair = async (table: string, base: Record<string, unknown>, publishedExtra: Record<string, unknown> = {}) => {
    await insertRow(t, table, { id: uuidv7(), ...base }, { status: "published", ...publishedExtra });
    await insertRow(t, table, { id: uuidv7(), ...base }, { status: "draft" });
  };
  await pair("programme", { university_id: universityPublished, name: "P" });
  await pair("fee_structure", { university_id: universityPublished, currency: "USD", period: "per_year" });
  await pair("campus_experience", { university_id: universityPublished, kind: "gallery", title: "T" });
  await pair("official_resource", { title: "R", url: "https://example.test" });
  const consentId = await consent(t);
  await pair("testimonial", { student_name: "S", quote: "Q" }, { verified: true, consent_id: consentId });
  await insertRow(t, "journey", { id: uuidv7(), student_name: "S", summary: "x" }, { status: "published", verified: true, consent_id: consentId });
  await insertRow(t, "journey", { id: uuidv7(), student_name: "S", summary: "x" }, { status: "draft" });
  await pair("team_member", { name: "N", role_title: "R" }, { confirmed: true });
  await pair("faq", { question: "Q", answer: "A" });
  await insertRow(t, "trust_stat", { id: uuidv7(), key: `k-${randomUUID()}`, label: "L", value: "V" }, { status: "published", confirmed: true });
  await insertRow(t, "trust_stat", { id: uuidv7(), key: `k-${randomUUID()}`, label: "L", value: "V" }, { status: "draft" });
  await insertRow(t, "post", { id: uuidv7(), slug: "published-post", title: "T", body: "B" }, { status: "published" });
  await insertRow(t, "post", { id: uuidv7(), slug: "draft-post", title: "T", body: "B" }, { status: "draft" });
  await pair("process_step", { kind: "application", position: 1, title: "T", body: "B" });
  await insertRow(t, "content_block", { id: uuidv7(), key: "published-block" }, { status: "published" });
  await insertRow(t, "content_block", { id: uuidv7(), key: "draft-block" }, { status: "draft" });
  void universityDraft;

  const journeys = (await t.run("select id, status from journey order by status")) as { id: string; status: string }[];
  for (const journey of journeys) await insertRow(t, "journey_step", { id: uuidv7(), journey_id: journey.id, position: 1, title: "S", body: "B" });

  // Staff-only content.
  await consent(t, { scope: "journey" });
  await insertRow(t, "message_template", { id: uuidv7(), stage_code: "share_results", locale: "en", body: "Hi {name}" });

  // Leads: stu-1's, stu-2's and an anonymous one.
  const l1 = await leadRow(t, { user_id: "stu-1" });
  const l2 = await leadRow(t, { user_id: "stu-2" });
  await leadRow(t);
  ids.l1 = l1;
  ids.l2 = l2;
  const programmeId = await programmeRow(t, universityPublished);
  await t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(l1)}, ${q(programmeId)}, 1)`);
  await t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(l2)}, ${q(programmeId)}, 1)`);
  await insertRow(t, "lead_activity", { id: uuidv7(), lead_id: l1, type: "created", actor_id: "adm-1" });
  await insertRow(t, "lead_note", { id: uuidv7(), lead_id: l1, author_id: "adm-1", body: "private" });
  await insertRow(t, "lead_claim", { id: uuidv7(), user_id: "stu-1", lead_id: l2, method: "ref" });
  await insertRow(t, "lead_claim", { id: uuidv7(), user_id: "stu-2", lead_id: l1, method: "number" });
  await insertRow(t, "lead_duplicate_decision", { id: uuidv7(), lead_a_id: l1, lead_b_id: l2, decision: "not_duplicate", decided_by: "adm-1" });
  await insertRow(t, "data_request", { id: uuidv7(), kind: "export", user_id: "stu-1", channel: "portal" });
  await insertRow(t, "data_request", { id: uuidv7(), kind: "erasure", user_id: "stu-2", channel: "portal" });

  // Identity extras.
  await insertRow(t, "admin_invite", { id: uuidv7(), email: "new@example.test", token_hash: `h-${randomUUID()}`, invited_by: "own-1", expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  await insertRow(t, "audit_log", { id: uuidv7(), actor_id: "own-1", action: "test", entity_type: "lead" });
  await insertRow(t, "owner_totp", { user_id: "own-1", secret_encrypted: "x" });
  await insertRow(t, "recovery_code", { id: uuidv7(), user_id: "own-1", code_hash: "h" });
  await insertRow(t, "step_up", { session_id: "sess-1", user_id: "own-1", verified_at: new Date().toISOString() });

  // Analytics, payments, media and the Stage 0 stubs.
  await insertRow(t, "event", { id: uuidv7(), type: "wa_tap" });
  await t.run(`insert into event_daily_agg (date, type, count) values ('2026-10-01', 'page_view', 1)`);
  await paymentRow(t, universityPublished, { entered_by: "adm-1" });
  await insertRow(t, "media_asset", { id: uuidv7(), kind: "logo", width: 1, height: 1, bytes: 1, mime: "image/webp", sha256: "b".repeat(64) });
  await t.run(`insert into phase0_content (key, value) values ('k', 'v')`);
  await t.run(`insert into phase0_lead_stub (id, idempotency_key, payload_hash, name, whatsapp_e164, country_code) values (${q(uuidv7())}, ${q(randomUUID())}, 'h', 'n', '+237651232301', 'CM')`);
});

afterAll(async () => {
  await t.close();
});

/** [table, anonymous, student (stu-1), admin, owner] */
const READS: [string, number, number, number, number][] = [
  // Public content: visitors and students see published rows only; staff see drafts too.
  ["university", 1, 1, 2, 2],
  ["programme", 1, 1, 3, 3], // plus the draft programme the lead preferences point at
  ["fee_structure", 1, 1, 2, 2],
  ["campus_experience", 1, 1, 2, 2],
  ["official_resource", 1, 1, 2, 2],
  ["testimonial", 1, 1, 2, 2],
  ["journey", 1, 1, 2, 2],
  ["journey_step", 1, 1, 2, 2],
  ["team_member", 1, 1, 2, 2],
  ["faq", 1, 1, 2, 2],
  ["trust_stat", 1, 1, 2, 2],
  ["post", 1, 1, 2, 2],
  ["process_step", 1, 1, 2, 2],
  ["content_block", 1, 1, 2, 2],
  // Open reference data.
  ["pipeline_stage", 6, 6, 6, 6],
  ["site_setting", 10, 10, 10, 10],
  ["media_asset", 1, 1, 1, 1],
  ["phase0_content", 1, 1, 1, 1],
  // Staff only.
  ["consent_record", 0, 0, 2, 2],
  ["message_template", 0, 0, 1, 1],
  ["lead_activity", 0, 0, 1, 1],
  ["lead_note", 0, 0, 1, 1],
  ["lead_duplicate_decision", 0, 0, 1, 1],
  ["event", 0, 0, 1, 1],
  ["event_daily_agg", 0, 0, 1, 1],
  ["placement_payment", 0, 0, 1, 1],
  ["phase0_lead_stub", 0, 0, 1, 1],
  // A student sees only their own.
  ["lead", 0, 1, 3, 3],
  ["lead_programme_pref", 0, 1, 2, 2],
  ["lead_claim", 0, 1, 2, 2],
  ["data_request", 0, 1, 2, 2],
  ["app_user", 0, 1, 4, 4],
  // Owner only.
  ["admin_invite", 0, 0, 0, 1],
  ["audit_log", 0, 0, 0, 1],
  // Only the user they belong to, so not even an admin reads another person's second factor.
  ["owner_totp", 0, 0, 0, 1],
  ["recovery_code", 0, 0, 0, 1],
  ["step_up", 0, 0, 0, 1],
];

describe("every table: who sees how many rows (ADR-038, architecture 9.5)", () => {
  it.each(READS)("%s: anonymous %i, student %i, admin %i, owner %i", async (table, anon, stu, adm, own) => {
    expect(await visible(anonymous, table), `${table} anonymous`).toBe(anon);
    expect(await visible(student, table), `${table} student`).toBe(stu);
    expect(await visible(admin, table), `${table} admin`).toBe(adm);
    expect(await visible(owner, table), `${table} owner`).toBe(own);
  });

  it("an owner who has not passed 2FA sees what a student sees", async () => {
    for (const table of ["lead", "lead_note", "placement_payment", "admin_invite", "audit_log", "consent_record"]) {
      expect(await visible(ownerWithout2fa, table), table).toBe(0);
    }
    // ...except their own second factor, which they must be able to read to pass the 2FA check at all.
    for (const table of ["owner_totp", "recovery_code", "step_up"]) expect(await visible(ownerWithout2fa, table), table).toBe(1);
    expect(await visible(ownerWithout2fa, "app_user")).toBe(1); // only their own row, like any student
    expect(await visible(ownerWithout2fa, "university")).toBe(1);
  });

  it("the table list above is every table in the database, so a new table must be added here", async () => {
    const rows = (await t.run("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")) as { table_name: string }[];
    const covered = new Set(READS.map(([table]) => table));
    expect(rows.map((r) => r.table_name).filter((name) => !covered.has(name))).toEqual([]);
  });

  it("without any context set, the runtime role sees nothing private", async () => {
    await t.asRuntime();
    try {
      const rows = (await t.run("select count(*)::int as n from lead")) as { n: number }[];
      expect(rows[0]?.n).toBe(0);
      const notes = (await t.run("select count(*)::int as n from lead_note")) as { n: number }[];
      expect(notes[0]?.n).toBe(0);
    } finally {
      await t.asOwner();
    }
  });

  it("a student sees their own lead and no one else's", async () => {
    const mine = await as(student, `select id from lead`);
    expect(mine.map((r) => r.id)).toEqual([ids.l1]);
    const theirs = await as(otherStudent, `select id from lead`);
    expect(theirs.map((r) => r.id)).toEqual([ids.l2]);
  });

  it("the runtime role cannot read Neon Auth's tables (only the SECURITY DEFINER functions can)", async () => {
    await t.asRuntime();
    try {
      await expect(t.run(`select * from neon_auth."user"`)).rejects.toThrow(/permission denied/);
      await expect(t.run(`select * from neon_auth.session`)).rejects.toThrow(/permission denied/);
    } finally {
      await t.asOwner();
    }
  });
});

describe("writes: the right person can, anyone else cannot", () => {
  it("only staff create content; a visitor and a student cannot", async () => {
    const insert = (slug: string) => `insert into university (id, slug, name) values (${q(uuidv7())}, '${slug}', 'N')`;
    await expectDenied(as(anonymous, insert("anon-uni")));
    await expectDenied(as(student, insert("stu-uni")));
    await expect(as(admin, insert("adm-uni"))).resolves.toBeDefined();
    await expect(as(owner, insert("own-uni"))).resolves.toBeDefined();
  });

  it("an update by someone who cannot see the row changes nothing and raises no error", async () => {
    const result = await as(student, `update university set name = 'hijacked' returning id`);
    expect(result).toEqual([]);
    const [row] = (await t.run(`select count(*)::int as n from university where name = 'hijacked'`)) as { n: number }[];
    expect(row?.n).toBe(0);
  });

  it("a student cannot change a lead, even their own; staff can", async () => {
    expect(await as(student, `update lead set locale = 'en' where id = ${q(ids.l1)} returning id`)).toEqual([]);
    expect((await as(admin, `update lead set locale = 'en' where id = ${q(ids.l1)} returning id`)).length).toBe(1);
  });

  it("nobody creates a lead directly: creation is a database function added with POST /api/v1/leads", async () => {
    const ref = "SC-AAAAA-BBBBB";
    const insert = `insert into lead (id, ref, client_ref, idempotency_key, payload_hash, name, whatsapp_e164, country_code, intake_kind, qualification_type, consent_notice_version, consent_at, sla_due_at, sla_hours_applied)
      values (${q(uuidv7())}, '${ref}', '${ref}', ${q(randomUUID())}, '${"a".repeat(64)}', 'N', '+237651232301', 'CM', 'full', 'olevel_alevel', 'v', now(), now(), 4)`;
    for (const ctx of [anonymous, student, admin, owner]) await expectDenied(as(ctx, insert));
  });

  it("a student can ask to link a lead for themselves, as pending, and not for someone else or as approved", async () => {
    const claim = (userId: string, status: string, method = "ref", extra = "") =>
      `insert into lead_claim (id, user_id, lead_id, method, status${extra ? ", verification_method" : ""}) values (${q(uuidv7())}, '${userId}', ${q(ids.l1)}, '${method}', '${status}'${extra ? `, '${extra}'` : ""})`;
    await expect(as(student, claim("stu-1", "pending"))).resolves.toBeDefined();
    await expectDenied(as(student, claim("stu-2", "pending")));
    await expectDenied(as(student, claim("stu-1", "approved", "ref", "email_match")));
    await expectDenied(as(student, claim("stu-1", "pending", "auto")));
    await expectDenied(as(anonymous, claim("stu-1", "pending")));
  });

  it("only staff decide a claim", async () => {
    const decide = `update lead_claim set status = 'rejected' where user_id = 'stu-1' returning id`;
    expect(await as(student, decide)).toEqual([]);
    expect((await as(admin, decide)).length).toBeGreaterThan(0);
  });

  it("a student files a data request for themselves only, through the portal", async () => {
    const request = (userId: string, channel: string) => `insert into data_request (id, kind, user_id, channel) values (${q(uuidv7())}, 'export', '${userId}', '${channel}')`;
    await expect(as(student, request("stu-1", "portal"))).resolves.toBeDefined();
    await expectDenied(as(student, request("stu-2", "portal")));
    await expectDenied(as(student, request("stu-1", "whatsapp")));
    await expectDenied(as(anonymous, request("stu-1", "portal")));
    await expect(as(admin, request("stu-1", "whatsapp"))).resolves.toBeDefined();
  });

  it("only the owner changes a setting; everyone can read it", async () => {
    const update = `update site_setting set value = '6'::jsonb where key = 'sla_weekday_hours' returning key`;
    expect(await as(anonymous, update)).toEqual([]);
    expect(await as(student, update)).toEqual([]);
    expect(await as(admin, update)).toEqual([]);
    expect(await as(ownerWithout2fa, update)).toEqual([]);
    expect((await as(owner, update)).length).toBe(1);
    await as(owner, `update site_setting set value = '4'::jsonb where key = 'sla_weekday_hours'`);
  });

  it("only staff record payments, and only as themselves", async () => {
    const universityId = ids.universityPublished ?? "";
    const record = (by: string) =>
      `insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by) values (${q(uuidv7())}, ${q(randomUUID())}, ${q(universityId)}, 100, '2026-10-01', '${by}')`;
    await expectDenied(as(student, record("stu-1")));
    await expectDenied(as(anonymous, record("x")));
    await expectDenied(as(admin, record("own-1")));
    await expect(as(admin, record("adm-1"))).resolves.toBeDefined();
  });

  it("an activity or a note is written as the signed-in staff member and no one else", async () => {
    const activity = (actor: string) => `insert into lead_activity (id, lead_id, type, actor_id) values (${q(uuidv7())}, ${q(ids.l1)}, 'note', '${actor}')`;
    await expect(as(admin, activity("adm-1"))).resolves.toBeDefined();
    await expectDenied(as(admin, activity("own-1")));
    await expectDenied(as(student, activity("stu-1")));
    const note = (author: string) => `insert into lead_note (id, lead_id, author_id, body) values (${q(uuidv7())}, ${q(ids.l1)}, '${author}', 'x')`;
    await expect(as(admin, note("adm-1"))).resolves.toBeDefined();
    await expectDenied(as(admin, note("own-1")));
    await expectDenied(as(student, note("stu-1")));
  });

  it("anyone signed in can write an audit entry about their own action, never about someone else's", async () => {
    const audit = (actor: string) => `insert into audit_log (id, actor_id, action, entity_type) values (${q(uuidv7())}, '${actor}', 'a', 'lead')`;
    await expect(as(student, audit("stu-1"))).resolves.toBeDefined();
    await expectDenied(as(student, audit("adm-1")));
    await expectDenied(as(anonymous, audit("stu-1")));
  });

  it("only the owner invites; an admin cannot read or create an invite", async () => {
    const invite = `insert into admin_invite (id, email, token_hash, invited_by, expires_at) values (${q(uuidv7())}, 'x@example.test', ${q(randomUUID())}, 'own-1', now() + interval '1 day')`;
    await expectDenied(as(admin, invite));
    await expectDenied(as(student, invite));
    await expect(as(owner, invite)).resolves.toBeDefined();
  });

  it("only the owner changes a role (the facade also demands the owner's 2FA)", async () => {
    const promote = `update app_user set role = 'admin' where id = 'stu-2' returning id`;
    expect(await as(admin, promote)).toEqual([]);
    expect(await as(student, promote)).toEqual([]);
    expect(await as(ownerWithout2fa, promote)).toEqual([]);
    expect((await as(owner, promote)).length).toBe(1);
    await as(owner, `update app_user set role = 'student' where id = 'stu-2'`);
  });
});

describe("no physical deletes (ADR-014): the runtime role has no DELETE on anything", () => {
  it.each(READS.map(([table]) => table))("%s", async (table) => {
    await t.asRuntime();
    try {
      await expect(t.run(`delete from ${table}`)).rejects.toThrow(/permission denied/);
    } finally {
      await t.asOwner();
    }
  });
});
