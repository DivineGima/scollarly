import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SETTING_KEYS } from "@/lib/constants";
import { mintActor, type Actor } from "@/server/auth/actor";
import { findLeadById, findLeadByRef, listLeads } from "@/server/repositories/leads";
import { listPipelineStages } from "@/server/repositories/pipeline";
import { readSettings, updateSetting } from "@/server/repositories/settings";
import { appUserRow, leadRow, q } from "./helpers/fixtures";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
const actor = (userId: string, role: "student" | "admin" | "owner", twoFactor = role === "owner"): Actor =>
  mintActor({ userId, sessionId: `s-${userId}`, storedRole: role, role, twoFactorVerifiedAt: twoFactor ? new Date() : null });

const student = actor("stu-1", "student");
const admin = actor("adm-1", "admin");
const owner = actor("own-1", "owner");
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestDb();
  await appUserRow(t, "stu-1");
  await appUserRow(t, "adm-1", "admin");
  await appUserRow(t, "own-1", "owner");
  ids.mine = await leadRow(t, { user_id: "stu-1" });
  ids.other = await leadRow(t);
  const [mine] = (await t.run(`select ref from lead where id = ${q(ids.mine)}`)) as { ref: string }[];
  ids.mineRef = mine?.ref ?? "";
  await t.asRuntime();
});

afterAll(async () => {
  await t.asOwner();
  await t.close();
});

describe("S1.2: repositories take an Actor, and the database is the second lock", () => {
  it("a function that touches protected data does not accept a plain object that is not an Actor (type check)", () => {
    // `tsc --noEmit` is part of CI: removing a ts-expect-error below, or the `Actor` parameter of a repository, fails the build.
    const forged = { userId: "adm-1", sessionId: "x", storedRole: "admin" as const, role: "admin" as const, twoFactorVerifiedAt: null };
    // @ts-expect-error a plain object is not a branded Actor; only the auth facade can mint one
    void (() => listLeads(t.db, forged));
    // @ts-expect-error the Actor is required, so an authorisation step cannot be forgotten
    void (() => listLeads(t.db));
    expect(true).toBe(true);
  });

  it("listLeads: staff see every lead, a student only their own", async () => {
    expect((await listLeads(t.db, admin)).map((l) => l.id).sort()).toEqual([ids.mine, ids.other].sort());
    expect((await listLeads(t.db, owner)).length).toBe(2);
    expect((await listLeads(t.db, student)).map((l) => l.id)).toEqual([ids.mine]);
  });

  it("an owner whose session has not passed 2FA reads as a student", async () => {
    const noSecondFactor = mintActor({ userId: "own-1", sessionId: "s", storedRole: "owner", role: "student", twoFactorVerifiedAt: null });
    expect(await listLeads(t.db, noSecondFactor)).toEqual([]);
  });

  it("never returns the idempotency key or the payload hash", async () => {
    const [row] = await listLeads(t.db, admin, { limit: 1 });
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("idempotencyKey");
    expect(row).not.toHaveProperty("payloadHash");
    expect(row).toHaveProperty("slaDueAt");
  });

  it("findLeadById and findLeadByRef return the lead for staff and its student, and null for everyone else", async () => {
    expect((await findLeadById(t.db, admin, ids.mine ?? ""))?.id).toBe(ids.mine);
    expect((await findLeadById(t.db, student, ids.mine ?? ""))?.id).toBe(ids.mine);
    expect(await findLeadById(t.db, student, ids.other ?? "")).toBeNull();
    expect((await findLeadByRef(t.db, admin, ids.mineRef ?? ""))?.id).toBe(ids.mine);
    expect(await findLeadByRef(t.db, student, "SC-00000-00000")).toBeNull();
    expect(await findLeadById(t.db, admin, "00000000-0000-7000-8000-000000000000")).toBeNull();
  });

  it("listLeads caps the page size and clamps nonsense", async () => {
    expect((await listLeads(t.db, admin, { limit: 1 })).length).toBe(1);
    expect((await listLeads(t.db, admin, { limit: 0 })).length).toBe(1); // at least one
    expect((await listLeads(t.db, admin, { limit: -5 })).length).toBe(1);
    expect((await listLeads(t.db, admin, { limit: 100000 })).length).toBe(2); // capped at 200, only two exist
    expect((await listLeads(t.db, admin, { offset: 1 })).length).toBe(1);
    expect(await listLeads(t.db, admin, { offset: 5 })).toEqual([]);
    expect((await listLeads(t.db, admin, { offset: -3 })).length).toBe(2);
  });

  it("listLeads is newest first", async () => {
    await t.asOwner();
    const newest = await leadRow(t, { received_at: new Date(Date.now() + 60_000).toISOString() });
    await t.asRuntime();
    expect((await listLeads(t.db, admin))[0]?.id).toBe(newest);
  });
});

describe("S1.2: settings and reference data", () => {
  it("readSettings returns every default setting to an anonymous reader", async () => {
    const settings = await readSettings(t.db);
    expect(Object.keys(settings).sort()).toEqual([...SETTING_KEYS].sort());
    expect(settings.sla_weekday_hours).toBe(4);
    expect(settings.whatsapp_number_e164).toBeNull();
  });

  it("only the owner changes a setting, and the new value is read back", async () => {
    expect(await updateSetting(t.db, student, "sla_weekday_hours", 2)).toBe(false);
    expect(await updateSetting(t.db, admin, "sla_weekday_hours", 2)).toBe(false);
    expect((await readSettings(t.db)).sla_weekday_hours).toBe(4);
    expect(await updateSetting(t.db, owner, "sla_weekday_hours", 6)).toBe(true);
    expect((await readSettings(t.db)).sla_weekday_hours).toBe(6);
    expect(await updateSetting(t.db, owner, "whatsapp_number_e164", "+237651232301")).toBe(true);
    expect((await readSettings(t.db)).whatsapp_number_e164).toBe("+237651232301");
    await updateSetting(t.db, owner, "sla_weekday_hours", 4);
    await updateSetting(t.db, owner, "whatsapp_number_e164", null);
  });

  it("lists the six pipeline stages in order", async () => {
    const stages = await listPipelineStages(t.db);
    expect(stages.map((s) => s.code)).toEqual(["share_results", "choose_course", "offer_letter", "confirm_admission", "visa", "arrived"]);
    expect(stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stages[0]?.name.en).toBe("Share results");
  });
});
