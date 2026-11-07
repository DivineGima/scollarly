import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanOut, type Sql } from "../../scripts/lib/cleanout-v5";
import { createTestDb, type TestDb } from "./helpers/db";
import { insertRow, leadRow, paymentRow, q, uni } from "./helpers/fixtures";

/**
 * The one-time clean-out (tracker_5 F41): everything of the other accounts goes, the owner's stays, a dry run changes nothing, and anything
 * unexpected rolls the whole thing back. Run against the committed migrations on a real engine, so the foreign-key order is proved.
 */

let t: TestDb;
const sql: Sql = async (statement) => (await t.run(statement)) as Record<string, unknown>[];
const n = async (statement: string) => Number(((await t.run(statement)) as { n: number }[])[0]?.n);
let keeper = "";

beforeAll(async () => {
  t = await createTestDb();
  const owner = await t.signIn({ email: "Owner@Example.test" });
  keeper = owner.userId;
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(keeper)}, 'admin', now())`);
  await t.run(`insert into owner_totp (user_id, secret_encrypted, confirmed) values (${q(keeper)}, 'cipher', true)`);

  const manager = await t.signIn({ email: "manager@example.test" });
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(manager.userId)}, 'manager', now())`);
  const university = await uni(t, { status: "published" });
  for (const who of ["a", "b"]) {
    const person = await t.signIn({ email: `student-${who}@example.test` });
    await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(person.userId)}, 'student', now())`);
    await t.run(`insert into student_profile (user_id, relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164, qualification_type, level, course_fields, intake_year, consent_notice_version, consent_at)
      values (${q(person.userId)}, 'student', 'A', 'CM', 'A', '+237612345678', 'olevel_alevel', 'undergraduate', ARRAY['law'], 2027, 'v1', now())`);
    const lead = await leadRow(t, { user_id: person.userId, assigned_manager_id: manager.userId });
    await t.run(`update student_profile set lead_id = ${q(lead)} where user_id = ${q(person.userId)}`);
    await insertRow(t, "lead_note", { id: randomUUID(), lead_id: lead, author_id: manager.userId, body: "n" });
    await insertRow(t, "lead_activity", { id: randomUUID(), lead_id: lead, type: "created", actor_id: manager.userId });
    await insertRow(t, "lead_claim", { id: randomUUID(), user_id: person.userId, lead_id: lead, method: "auto" });
    await paymentRow(t, university, { lead_id: lead, entered_by: manager.userId });
    await insertRow(t, "data_request", { id: randomUUID(), kind: "export", user_id: person.userId, channel: "portal" });
    await insertRow(t, "event", { id: randomUUID(), type: "wa_tap", lead_id: lead, lead_ref: "SC-AAAAA-AAAAA" });
  }
  await leadRow(t, {}); // a lead that belongs to nobody
  await t.run(`insert into neon_auth.account ("accountId", "providerId", "userId") values ('g-1', 'google', ${q(manager.userId)})`);
});

afterAll(async () => {
  await t.close();
});

describe("the clean-out (F41)", () => {
  it("a dry run reports what would go and changes nothing", async () => {
    const report = await cleanOut(sql, { keepEmail: "owner@example.test", confirm: false });
    expect(report.committed).toBe(false);
    expect(report.keptUserId).toBe(keeper);
    expect(report.before.app_user).toBe(4);
    expect(report.after.app_user).toBe(1);
    expect(report.deleted).toMatchObject({ app_user: 3, student_profile: 2, lead: 2, lead_note: 2, placement_payment: 2, data_request: 2 });
    expect(await n(`select count(*)::int as n from app_user`)).toBe(4);
    expect(await n(`select count(*)::int as n from lead`)).toBe(3);
    expect(await n(`select count(*)::int as n from placement_payment`)).toBe(2);
  });

  it("refuses an email that is not exactly one account or is not the owner or an admin, and changes nothing", async () => {
    await expect(cleanOut(sql, { keepEmail: "nobody@example.test", confirm: true })).rejects.toThrow(/exactly one account/);
    await expect(cleanOut(sql, { keepEmail: "student-a@example.test", confirm: true })).rejects.toThrow(/must be the owner/);
    await expect(cleanOut(sql, { keepEmail: "", confirm: true })).rejects.toThrow(/required/);
    expect(await n(`select count(*)::int as n from app_user`)).toBe(4);
  });

  it("with confirm it keeps the owner and their rows, deletes the rest, leaves the unlinked lead, and clears the event links", async () => {
    const report = await cleanOut(sql, { keepEmail: "OWNER@example.test", confirm: true });
    expect(report.committed).toBe(true);
    expect(await n(`select count(*)::int as n from app_user`)).toBe(1);
    expect(await n(`select count(*)::int as n from app_user where id = ${q(keeper)} and role = 'admin'`)).toBe(1);
    expect(await n(`select count(*)::int as n from owner_totp where user_id = ${q(keeper)}`)).toBe(1);
    expect(await n(`select count(*)::int as n from neon_auth."user"`)).toBe(1);
    expect(await n(`select count(*)::int as n from neon_auth.account`)).toBe(0);
    expect(await n(`select count(*)::int as n from student_profile`)).toBe(0);
    expect(await n(`select count(*)::int as n from lead`)).toBe(1); // the one that belonged to nobody
    expect(await n(`select count(*)::int as n from placement_payment`)).toBe(0);
    expect(await n(`select count(*)::int as n from lead_note`)).toBe(0);
    expect(await n(`select count(*)::int as n from event where lead_id is not null or lead_ref is not null`)).toBe(0);
    expect(await n(`select count(*)::int as n from event`)).toBe(2); // the analytics rows stay
  });

  it("running it again finds nothing more to delete", async () => {
    const report = await cleanOut(sql, { keepEmail: "owner@example.test", confirm: true });
    expect(report.deleted.app_user).toBe(0);
    expect(report.after.app_user).toBe(1);
  });
});
