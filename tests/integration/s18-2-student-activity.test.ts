import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/uuid";
import { type RlsContext, inContext } from "@/server/db/rls";
import { rowsOf } from "@/server/db/rows";
import { createTestDb, type TestDb } from "./helpers/db";
import { appUserRow, applyForProfile, q } from "./helpers/fixtures";

/**
 * S18.2 (migration 0026, architecture 24.7): `lead.last_student_activity_at` follows what the STUDENT does, and only that. It is what "gone quiet"
 * and "suggest closing" are computed from, so a manager approving a document, an admin uploading a letter or a reassignment must not move it.
 */

let t: TestDb;
const ctx = (userId: string, role: RlsContext["role"]): RlsContext => ({ userId, role });

async function as(context: RlsContext, statement: string): Promise<Record<string, unknown>[]> {
  await t.asRuntime();
  try {
    const [result] = await inContext(t.db, context, t.db.execute(sql.raw(statement)));
    return rowsOf<Record<string, unknown>>(result);
  } finally {
    await t.asOwner();
  }
}

const one = async (statement: string) => ((await t.run(statement)) as Record<string, unknown>[])[0];
const OLD = "now() - interval '30 days'";

let leadId: string;
const lastActivityAgeDays = async () => Number((await one(`select floor(extract(epoch from (now() - last_student_activity_at)) / 86400)::int as d from lead where id = ${q(leadId)}`))?.d);
const makeOld = () => t.run(`update lead set last_student_activity_at = ${OLD} where id = ${q(leadId)}`);

beforeAll(async () => {
  t = await createTestDb();
  await appUserRow(t, "act-mgr", "manager");
  await appUserRow(t, "act-adm", "admin");
  await t.run(`insert into app_user (id, role, account_confirmed_at) values ('act-stu', 'student', now())`);
  await as(ctx("act-stu", "student"), `select out_outcome from public.app_complete_profile('Ada Eze', '+2348031234567', 'NG', 'olevel_alevel', '[]'::jsonb, 'v1', now(), 'student', 'Ada Eze', 'undergraduate', ARRAY['law'], 2027::smallint)`);
  await t.run(`update student_profile set assigned_manager_id = 'act-mgr' where user_id = 'act-stu'`);
  leadId = await applyForProfile(t, "act-stu", { assigned_manager_id: "act-mgr", stage_code: "documents" });
});

afterAll(async () => {
  await t.close();
});

describe("S18.2 the student's last activity", () => {
  it("moves when the student asks to send a document and when it is checked", async () => {
    await makeOld();
    expect(await lastActivityAgeDays()).toBe(30);
    const id = uuidv7();
    await as(ctx("act-stu", "student"), `insert into student_document (id, student_id, kind, storage_key, content_type, byte_size, state) values (${q(id)}, 'act-stu', 'id', 'act-stu/${id}', 'image/png', 10, 'pending')`);
    expect(await lastActivityAgeDays()).toBe(0);

    await makeOld();
    await as(ctx("act-stu", "student"), `update student_document set state = 'uploaded' where id = ${q(id)}`);
    expect(await lastActivityAgeDays()).toBe(0);
  });

  it("moves when the student saves their own form", async () => {
    await makeOld();
    await as(ctx("act-stu", "student"), `update student_profile set city = 'Ikeja' where user_id = 'act-stu'`);
    expect(await lastActivityAgeDays()).toBe(0);
  });

  it("does not move when staff act on the file: a review, a letter, a reassignment", async () => {
    const id = uuidv7();
    await t.run(`insert into student_document (id, student_id, kind, storage_key, content_type, byte_size, state) values (${q(id)}, 'act-stu', 'results', 'act-stu/${id}', 'image/png', 10, 'uploaded')`);
    await makeOld();
    await as(ctx("act-mgr", "manager"), `update student_document set state = 'approved', reviewed_by = 'act-mgr', reviewed_at = now() where id = ${q(id)}`);
    expect(await lastActivityAgeDays()).toBe(30);

    const letter = uuidv7();
    await as(ctx("act-adm", "admin"), `insert into student_document (id, student_id, kind, storage_key, content_type, byte_size, state) values (${q(letter)}, 'act-stu', 'offer_letter', 'act-stu/${letter}', 'application/pdf', 10, 'pending')`);
    await as(ctx("act-adm", "admin"), `update student_document set state = 'uploaded' where id = ${q(letter)}`);
    expect(await lastActivityAgeDays()).toBe(30);

    await as(ctx("act-adm", "admin"), `update student_profile set assigned_manager_id = 'act-mgr', city = 'Lagos' where user_id = 'act-stu'`);
    expect(await lastActivityAgeDays()).toBe(30);
  });

  it("touches only the student's own open lead: a closed file keeps its time, and another student's file is untouched", async () => {
    await t.run(`insert into app_user (id, role, account_confirmed_at) values ('act-other', 'student', now())`);
    await as(ctx("act-other", "student"), `select out_outcome from public.app_complete_profile('Kofi Mensah', '+2348039999999', 'NG', 'olevel_alevel', '[]'::jsonb, 'v1', now(), 'student', 'Kofi Mensah', 'undergraduate', ARRAY['law'], 2027::smallint)`);
    const other = await applyForProfile(t, "act-other", { stage_code: "documents" });
    await t.run(`update lead set last_student_activity_at = ${OLD} where id = ${q(other)}`);
    await makeOld();
    await t.run(`update lead set status = 'closed', closed_reason = 'no_response', closed_at = now() where id = ${q(leadId)}`);
    await as(ctx("act-stu", "student"), `update student_profile set city = 'Abuja' where user_id = 'act-stu'`);
    expect(await lastActivityAgeDays()).toBe(30); // closed: not touched
    const age = Number((await one(`select floor(extract(epoch from (now() - last_student_activity_at)) / 86400)::int as d from lead where id = ${q(other)}`))?.d);
    expect(age).toBe(30); // someone else's file: not touched
  });

  it("is not callable by the signed-in role directly", async () => {
    await expect(as(ctx("act-stu", "student"), `select public.app_touch_student_activity('act-stu')`)).rejects.toThrow();
  });
});
