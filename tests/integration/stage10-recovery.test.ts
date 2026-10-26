import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import { q } from "./helpers/fixtures";

/** S10.4: the written recovery procedure for a locked-out owner is a SQL file; this runs that exact file against a real database. */

let t: TestDb;
let ownerId = "";
let adminId = "";
const SQL = readFileSync("scripts/ops/reset-owner-2fa.sql", "utf8");
/** The file's statements one at a time (the test driver runs one statement per call); begin and commit are the file's own transaction. */
const statements = SQL.split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("--"))
  .join(" ")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s !== "" && s !== "begin" && s !== "commit");
const runFile = async () => {
  for (const statement of statements) await t.run(statement);
};
const count = async (sql: string) => Number(((await t.run(sql)) as { n: number }[])[0]?.n);

beforeAll(async () => {
  t = await createTestDb();
  const owner = await t.signIn();
  const admin = await t.signIn();
  ownerId = owner.userId;
  adminId = admin.userId;
  await t.run(`insert into app_user (id, role) values (${q(ownerId)}, 'owner'), (${q(adminId)}, 'admin')`);
  await t.run(`insert into owner_totp (user_id, secret_encrypted, confirmed) values (${q(ownerId)}, 'cipher', true)`);
  await t.run(`insert into recovery_code (id, user_id, code_hash) values (gen_random_uuid(), ${q(ownerId)}, 'h1'), (gen_random_uuid(), ${q(ownerId)}, 'h2')`);
  await t.run(`insert into step_up (session_id, user_id, verified_at) values (${q(owner.sessionId)}, ${q(ownerId)}, now()), (${q(admin.sessionId)}, ${q(adminId)}, now())`);
});
afterAll(async () => {
  await t.close();
});

describe("recovery: owner locked out of two-factor", () => {
  it("clears the owner's second factor and sessions, keeps the account and everyone else, and records it", async () => {
    expect(statements).toHaveLength(5);
    await runFile();
    expect(await count("select count(*)::int as n from owner_totp")).toBe(0);
    expect(await count("select count(*)::int as n from recovery_code")).toBe(0);
    expect(await count(`select count(*)::int as n from step_up where user_id = ${q(ownerId)}`)).toBe(0);
    expect(await count(`select count(*)::int as n from neon_auth.session where "userId"::text = ${q(ownerId)}`)).toBe(0);
    // The owner account and the admin are untouched.
    expect(await count(`select count(*)::int as n from app_user where id = ${q(ownerId)} and role = 'owner'`)).toBe(1);
    expect(await count(`select count(*)::int as n from app_user where id = ${q(adminId)} and role = 'admin'`)).toBe(1);
    expect(await count(`select count(*)::int as n from step_up where user_id = ${q(adminId)}`)).toBe(1);
    expect(await count(`select count(*)::int as n from neon_auth.session where "userId"::text = ${q(adminId)}`)).toBe(1);
    expect(await count("select count(*)::int as n from audit_log where action = 'security.ownerTwoFactorReset' and actor_id is null")).toBe(1);
  });

  it("is safe to run twice", async () => {
    await runFile();
    expect(await count("select count(*)::int as n from owner_totp")).toBe(0);
    expect(await count(`select count(*)::int as n from app_user where id = ${q(ownerId)}`)).toBe(1);
  });
});
