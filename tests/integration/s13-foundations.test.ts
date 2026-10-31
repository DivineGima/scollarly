import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, inContext, type RlsContext } from "@/server/db/rls";
import { rowsOf } from "@/server/db/rows";
import { resolveSession } from "@/server/repositories/identity";
import { appUserRow, leadRow, q } from "./helpers/fixtures";
import { createTestDb, type TestDb } from "./helpers/db";

/**
 * S13.1 (architecture 21.2, 21.3): migration 0013. The account-confirmed flag and the session function that reports it, the three
 * functions that are the only way a user changes their own `app_user` columns, row level security on `student_profile`, the widened
 * lead checks, and erasure taking the onboarding answers with it.
 */

let t: TestDb;
const student: RlsContext = { userId: "stu-1", role: "student" };
const otherStudent: RlsContext = { userId: "stu-2", role: "student" };
const admin: RlsContext = { userId: "adm-1", role: "admin" };
const owner: RlsContext = { userId: "own-1", role: "owner" };

async function as(ctx: RlsContext, statement: string): Promise<Record<string, unknown>[]> {
  await t.asRuntime();
  try {
    const [result] = await inContext(t.db, ctx, t.db.execute(sql.raw(statement)));
    return rowsOf<Record<string, unknown>>(result);
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

const profile = (userId: string, overrides: Record<string, string | number> = {}) => {
  const v = { relationship: "student", applicant_name: "Ada", applicant_country: "CM", contact_name: "Ada", contact_whatsapp_e164: "+237612345678", qualification_type: "olevel_alevel", level: "undergraduate", intake_year: 2027, consent_notice_version: "v1", ...overrides };
  return `insert into student_profile (user_id, relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164, qualification_type, level, course_fields, intake_year, consent_notice_version, consent_at)
          values (${q(userId)}, ${q(v.relationship)}, ${q(v.applicant_name)}, ${q(v.applicant_country)}, ${q(v.contact_name)}, ${q(v.contact_whatsapp_e164)}, ${q(v.qualification_type)}, ${q(v.level)}, ARRAY['law','commerce'], ${v.intake_year}, ${q(v.consent_notice_version)}, now())`;
};

const confirmedAt = async (userId: string) => (await t.run(`select account_confirmed_at from app_user where id = ${q(userId)}`))[0] as { account_confirmed_at: unknown };

beforeAll(async () => {
  t = await createTestDb();
  await appUserRow(t, "stu-1");
  await appUserRow(t, "stu-2");
  await appUserRow(t, "adm-1", "admin");
  await appUserRow(t, "own-1", "owner");
});

afterAll(async () => {
  await t.close();
});

describe("account confirmation (ADR-042)", () => {
  it("reports a brand-new Google login as not confirmed, and creates its pending row", async () => {
    const user = await t.signIn();
    const first = await resolveSession(t.db, user.token);
    expect(first?.userId).toBe(user.userId);
    expect(first?.role).toBe("student");
    expect(first?.accountConfirmed).toBe(false);
    expect(await resolveSession(t.db, user.token)).toMatchObject({ accountConfirmed: false });
    expect((await confirmedAt(user.userId)).account_confirmed_at).toBeNull();
  });

  it("returns null for an unknown session, exactly as before", async () => {
    expect(await resolveSession(t.db, "no-such-token-0000000000000000000")).toBeNull();
  });

  it("confirms the caller's own account once, writes one audit row, and is idempotent", async () => {
    const user = await t.signIn();
    await resolveSession(t.db, user.token);
    const ctx: RlsContext = { userId: user.userId, role: "student" };
    expect((await as(ctx, "select public.app_confirm_account() as ok"))[0]?.ok).toBe(true);
    expect((await as(ctx, "select public.app_confirm_account() as ok"))[0]?.ok).toBe(false);
    expect(await resolveSession(t.db, user.token)).toMatchObject({ accountConfirmed: true });
    const audit = (await t.run(`select count(*)::int as n from audit_log where action = 'account.confirmed' and actor_id = ${q(user.userId)}`)) as { n: number }[];
    expect(audit[0]?.n).toBe(1);
  });

  it("refuses an anonymous caller", async () => {
    expect(await reasonOf(as(ANONYMOUS, "select public.app_confirm_account()"))).toMatch(/Sign in required/);
  });

  it("confirms an account when it is promoted to admin or owner (invite accepted, owner bootstrap)", async () => {
    await appUserRow(t, "promote-1");
    expect((await confirmedAt("promote-1")).account_confirmed_at).toBeNull();
    await t.run("update app_user set role = 'admin' where id = 'promote-1'");
    expect((await confirmedAt("promote-1")).account_confirmed_at).not.toBeNull();
  });

  it("confirms a staff row that is created as admin or owner, but not a student row", async () => {
    await appUserRow(t, "staff-1", "admin");
    await appUserRow(t, "student-new");
    expect((await confirmedAt("staff-1")).account_confirmed_at).not.toBeNull();
    expect((await confirmedAt("student-new")).account_confirmed_at).toBeNull();
  });

  it("leaves an unconfirmed account unconfirmed when something else about it changes", async () => {
    await appUserRow(t, "plain-1");
    await t.run("update app_user set notifications_seen_at = now() where id = 'plain-1'");
    expect((await confirmedAt("plain-1")).account_confirmed_at).toBeNull();
  });
});

describe("the only way a user changes their own app_user columns (21.2)", () => {
  it("cannot change their own role or confirmed time by a direct update", async () => {
    expect(await as(student, "update app_user set role = 'admin' where id = 'stu-1' returning id")).toEqual([]);
    expect(await as(student, "update app_user set account_confirmed_at = now() where id = 'stu-1' returning id")).toEqual([]);
    expect(await as(student, "update app_user set notifications_seen_at = now() where id = 'stu-1' returning id")).toEqual([]);
    expect((await t.run("select role from app_user where id = 'stu-1'"))[0]).toEqual({ role: "student" });
  });

  it("moves only the caller's own notifications time", async () => {
    await as(student, "select public.app_mark_notifications_seen()");
    const rows = (await t.run("select id, notifications_seen_at from app_user where id in ('stu-1', 'stu-2') order by id")) as { id: string; notifications_seen_at: unknown }[];
    expect(rows[0]?.notifications_seen_at).not.toBeNull();
    expect(rows[1]?.notifications_seen_at).toBeNull();
    expect(await reasonOf(as(ANONYMOUS, "select public.app_mark_notifications_seen()"))).toMatch(/Sign in required/);
  });

  it("records a tour once, keeps tours per user, and refuses a bad key", async () => {
    await as(otherStudent, "select public.app_mark_tour_seen('home')");
    await as(otherStudent, "select public.app_mark_tour_seen('home')");
    await as(otherStudent, "select public.app_mark_tour_seen('leads')");
    const rows = (await t.run("select id, tours_seen from app_user where id in ('stu-1', 'stu-2') order by id")) as { id: string; tours_seen: string[] }[];
    expect(rows[1]?.tours_seen).toEqual(["home", "leads"]);
    expect(rows[0]?.tours_seen).toEqual([]);
    for (const bad of ["", "Home", "a", "has space", "x".repeat(21), "drop;table"]) {
      expect(await reasonOf(as(otherStudent, `select public.app_mark_tour_seen(${q(bad)})`)), bad).toMatch(/Unknown tab/);
    }
  });

  it("keeps at most 20 tours", async () => {
    await appUserRow(t, "many-1");
    const ctx: RlsContext = { userId: "many-1", role: "student" };
    for (let i = 0; i < 25; i += 1) await as(ctx, `select public.app_mark_tour_seen('tab${"abcdefghijklmnopqrstuvwxy"[i]}')`);
    const [row] = (await t.run("select cardinality(tours_seen) as n from app_user where id = 'many-1'")) as { n: number }[];
    expect(row?.n).toBe(20);
  });
});

describe("student_profile: row level security (ADR-038)", () => {
  it("lets a student write and read only their own row", async () => {
    await as(student, profile("stu-1"));
    expect(await reasonOf(as(student, profile("stu-2")))).toMatch(/row-level security/);
    expect(await reasonOf(as(ANONYMOUS, profile("stu-1")))).toMatch(/row-level security|permission denied/);
    await as(otherStudent, profile("stu-2", { relationship: "parent", applicant_name: "Child", contact_name: "Parent" }));
    expect((await as(student, "select user_id from student_profile")).map((r) => r.user_id)).toEqual(["stu-1"]);
    expect(await as(ANONYMOUS, "select user_id from student_profile")).toEqual([]);
  });

  it("lets staff read every row and nobody read another student's row", async () => {
    expect((await as(admin, "select user_id from student_profile")).length).toBe(2);
    expect((await as(owner, "select user_id from student_profile")).length).toBe(2);
    expect(await as(otherStudent, "select user_id from student_profile where user_id = 'stu-1'")).toEqual([]);
  });

  it("lets a user update their own row, and no row of anyone else", async () => {
    expect((await as(student, "update student_profile set intake_year = 2028 where user_id = 'stu-1' returning user_id")).length).toBe(1);
    expect(await as(student, "update student_profile set intake_year = 2030 where user_id = 'stu-2' returning user_id")).toEqual([]);
    expect(await as(admin, "update student_profile set intake_year = 2030 where user_id = 'stu-1' returning user_id")).toEqual([]);
  });

  it("allows no delete for any runtime role (erasure removes the row through its own function)", async () => {
    for (const ctx of [student, admin, owner]) expect(await reasonOf(as(ctx, "delete from student_profile where user_id = 'stu-1'"))).toMatch(/permission denied/);
  });

  it("is forced for the table owner too", async () => {
    const [row] = (await t.run("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'student_profile'")) as { relrowsecurity: boolean; relforcerowsecurity: boolean }[];
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe("student_profile: what the database refuses", () => {
  const rejected = async (user: string, overrides: Record<string, string | number>) => {
    await appUserRow(t, user);
    return reasonOf(t.run(profile(user, overrides)));
  };

  it("refuses an unknown relationship, level, country, number, qualification or year", async () => {
    expect(await rejected("bad-1", { relationship: "guardian" })).toMatch(/student_profile_relationship_check/);
    expect(await rejected("bad-2", { level: "doctorate" })).toMatch(/student_profile_level_check/);
    expect(await rejected("bad-3", { applicant_country: "cameroon" })).toMatch(/student_profile_country_format/);
    expect(await rejected("bad-4", { contact_whatsapp_e164: "0612345678" })).toMatch(/student_profile_whatsapp_format/);
    expect(await rejected("bad-5", { qualification_type: "degree" })).toMatch(/student_profile_qualification_type_check/);
    expect(await rejected("bad-6", { intake_year: 1999 })).toMatch(/student_profile_intake_year_range/);
  });

  it("accepts one to five known course fields and nothing else", async () => {
    const insert = (user: string, fields: string) =>
      t.run(`insert into student_profile (user_id, relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164, qualification_type, level, course_fields, intake_year, consent_notice_version, consent_at)
             values (${q(user)}, 'student', 'A', 'CM', 'A', '+237612345678', 'olevel_alevel', 'undergraduate', ${fields}, 2027, 'v1', now())`);
    await appUserRow(t, "cf-1");
    await appUserRow(t, "cf-2");
    await appUserRow(t, "cf-3");
    await appUserRow(t, "cf-4");
    expect(await reasonOf(insert("cf-1", "ARRAY[]::text[]"))).toMatch(/student_profile_course_fields_count/);
    expect(await reasonOf(insert("cf-2", "ARRAY['law','commerce','pharmacy','science_arts','health_nursing','civil_engineering']"))).toMatch(/student_profile_course_fields_count/);
    expect(await reasonOf(insert("cf-3", "ARRAY['astrology']"))).toMatch(/student_profile_course_fields_known/);
    expect(await reasonOf(insert("cf-4", "ARRAY['law','commerce','pharmacy','science_arts','health_nursing']"))).toBe("");
  });
});

describe("the lead checks (21.2, ADR-043)", () => {
  const withResults = [{ subject: "Maths", grade: "A" }];

  it("accepts an onboarding lead that carries grades, like a full one", async () => {
    expect(await reasonOf(leadRow(t, { intake_kind: "onboarding", results: withResults }))).toBe("");
  });

  it("still refuses grades on a quick lead, a missing qualification on a full or onboarding lead, and an unknown kind", async () => {
    expect(await reasonOf(leadRow(t, { intake_kind: "quick", qualification_type: null, results: withResults }))).toMatch(/lead_quick_has_no_results/);
    expect(await reasonOf(leadRow(t, { intake_kind: "onboarding", qualification_type: null }))).toMatch(/lead_qualification_required_for_full/);
    expect(await reasonOf(leadRow(t, { intake_kind: "full", qualification_type: null }))).toMatch(/lead_qualification_required_for_full/);
    expect(await reasonOf(leadRow(t, { intake_kind: "bogus" }))).toMatch(/lead_intake_kind_check/);
  });
});

describe("erasure takes the onboarding answers with the account (7.9)", () => {
  it("deletes the profile, anonymises the lead it created, and removes the account", async () => {
    const user = await t.signIn();
    await resolveSession(t.db, user.token);
    await t.run(profile(user.userId));
    const leadId = await leadRow(t, { user_id: user.userId, intake_kind: "onboarding", idempotency_key: randomUUID() });
    await t.run(`update student_profile set lead_id = ${q(leadId)} where user_id = ${q(user.userId)}`);

    const ctx: RlsContext = { userId: user.userId, role: "student" };
    expect((await as(ctx, `select public.app_erase_my_account(${q(user.token)}) as result`))[0]?.result).toBe("erased");

    expect(await t.run(`select 1 from student_profile where user_id = ${q(user.userId)}`)).toEqual([]);
    expect(await t.run(`select 1 from app_user where id = ${q(user.userId)}`)).toEqual([]);
    const [anonymised] = (await t.run(`select name, whatsapp_e164, user_id, anonymised_at from lead where id = ${q(leadId)}`)) as { name: unknown; whatsapp_e164: unknown; user_id: unknown; anonymised_at: unknown }[];
    expect(anonymised?.name).toBeNull();
    expect(anonymised?.whatsapp_e164).toBeNull();
    expect(anonymised?.user_id).toBeNull();
    expect(anonymised?.anonymised_at).not.toBeNull();
  });
});
