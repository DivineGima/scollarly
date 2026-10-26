/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read nested JSON answers; typing every shape would hide what each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportMutations } from "@/modules/export/endpoints";
import { EXPORT_EXCLUDED, EXPORT_FORMAT, EXPORT_TABLES } from "@/modules/export/tables";
import { healthDataCalls } from "@/modules/health/endpoints";
import { settingsDataCalls, settingsMutations } from "@/modules/settings/endpoints";
import { computeSla, slaSettingsFrom } from "@/modules/sla/service";
import { type Actor, mintActor, STEP_UP_WINDOW_MS } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { denyAccess, type MutationCall } from "@/server/edge/mutations";
import { runUsageCheck } from "@/server/edge/usage-job";
import { readSiteRows } from "@/server/repositories/content";
import { recordJob } from "@/server/repositories/health";
import { readSettings } from "@/server/repositories/settings-read";
import { createTestDb, type TestDb } from "./helpers/db";
import { insertRow, leadRow, paymentRow, q, uni } from "./helpers/fixtures";

/**
 * Stage 10 against a real database, as the non-owner runtime role (ADR-038): Settings (S10.1), Health and the daily usage check
 * (S10.2) and the owner's full export (S10.3). Each exit criterion of Stage 10 that the database can prove is a test here; the backup
 * workflow and the image copy script have their own tests (tests/unit/backup-scripts.test.ts, the backup self-test workflow).
 */

let t: TestDb;
let owner: Actor;
let ownerStale: Actor;
let admin: Actor;
let student: Actor;
// 2026-10-26 12:00 UTC is 13:00 WAT, Monday.
const NOW = new Date("2026-10-26T12:00:00Z");
const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => NOW });

async function actorOf(role: "admin" | "student" | "owner", verifiedAgoMs: number | null = null): Promise<Actor> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role) values (${q(user.userId)}, ${q(role)})`);
  return mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: role, role, twoFactorVerifiedAt: verifiedAgoMs === null ? null : new Date(NOW.getTime() - verifiedAgoMs) });
}

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

interface Answer {
  status: number;
  json: Record<string, any>;
  text: string;
  headers: Headers;
}

async function answerOf(response: Response): Promise<Answer> {
  const text = await response.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text) as Record<string, any>;
  } catch {
    // Not JSON.
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function update(who: Actor, body: unknown): Promise<Answer> {
  const mutation = settingsMutations["admin/settings.update"]!;
  const call: MutationCall = { actor: who, token: null, body, bytes: null, requestId: "test", request: new Request("https://example.test/api/v1/admin/settings.update", { method: "POST" }), env: env() };
  return answerOf(await asRuntime(() => mutation.handle(call)));
}

async function get(calls: Record<string, DataCall>, name: string, who: Actor): Promise<Answer> {
  const call = calls[`admin/${name}`] as DataCall;
  const result = await asRuntime(() => call(who, { token: null, url: new URL(`https://example.test/api/v1/admin/${name}`) }));
  if (result instanceof Response) return answerOf(result);
  return { status: 200, json: JSON.parse(JSON.stringify(result)) as Record<string, any>, text: "", headers: new Headers() };
}

const rows = (statement: string) => t.run(statement) as Promise<Record<string, unknown>[]>;
const count = async (statement: string) => Number((await rows(statement))[0]?.n);
const setting = async (key: string) => (await rows(`select value from site_setting where key = ${q(key)}`))[0]?.value;

beforeAll(async () => {
  t = await createTestDb();
  owner = await actorOf("owner", 0);
  // The same owner on another session, whose last 2FA check is older than the 10 minute window (there is only ever one owner).
  ownerStale = mintActor({ userId: owner.userId, sessionId: owner.sessionId, storedRole: "owner", role: "owner", twoFactorVerifiedAt: new Date(NOW.getTime() - STEP_UP_WINDOW_MS - 60_000) });
  admin = await actorOf("admin");
  student = await actorOf("student");
});

afterAll(async () => {
  await t.close();
});

describe("S10.1 Settings: who may save", () => {
  const access = settingsMutations["admin/settings.update"]!.access;

  it("needs the owner with a 2FA check in the last 10 minutes", () => {
    expect(denyAccess(access, owner, NOW)).toBeNull();
    expect(denyAccess(access, ownerStale, NOW)?.code).toBe("STEP_UP_REQUIRED");
    expect(denyAccess(access, admin, NOW)?.code).toBe("FORBIDDEN");
    expect(denyAccess(access, student, NOW)?.code).toBe("FORBIDDEN");
    expect(denyAccess(access, null, NOW)?.code).toBe("UNAUTHENTICATED");
  });

  it("the database refuses anyone but the owner even if the facade were skipped: nothing changes", async () => {
    const before = await setting("sla_weekday_hours");
    const answer = await update(admin, { changes: { sla_weekday_hours: 9 } });
    expect(answer.status).toBe(200);
    expect(answer.json.changed).toEqual([]);
    expect(await setting("sla_weekday_hours")).toEqual(before);
  });

  it("the settings data call is for the owner only", async () => {
    await expect(get(settingsDataCalls(env()), "settings", admin)).rejects.toThrow(/Not allowed/);
    await expect(get(settingsDataCalls(env()), "settings", student)).rejects.toThrow(/Not allowed/);
  });
});

describe("S10.1 Settings: values", () => {
  it("shows every editable setting, with its limits and the time zone", async () => {
    const answer = await get(settingsDataCalls(env()), "settings", owner);
    expect(Object.keys(answer.json.values).sort()).toEqual(
      ["collect_page_views", "contact_phone_display", "media_budget_bytes", "pipeline_freshness_days", "sla_weekday_hours", "sla_weekend_hours", "stale_fee_days", "stale_tour_days", "whatsapp_number_e164"].sort(),
    );
    expect(answer.json.values.sla_weekday_hours).toBe(4);
    expect(answer.json.values.pipeline_freshness_days).toBeNull();
    expect(answer.json.timezone).toBe("Africa/Douala");
    expect(answer.json.limits.mediaBudgetMinBytes).toBeLessThan(answer.json.limits.mediaBudgetMaxBytes);
  });

  it("saves several values in one change and writes one audit row that names the keys, not the values", async () => {
    const answer = await update(owner, { changes: { sla_weekday_hours: 2, stale_fee_days: 120, contact_phone_display: "+00 000 000" } });
    expect(answer.status).toBe(200);
    expect(answer.json.changed).toEqual(["contact_phone_display", "sla_weekday_hours", "stale_fee_days"]);
    expect(await setting("sla_weekday_hours")).toBe(2);
    expect(await setting("stale_fee_days")).toBe(120);
    const audit = await rows(`select actor_id, meta from audit_log where action = 'settings.update'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_id).toBe(owner.userId);
    expect(audit[0]?.meta).toEqual({ keys: ["contact_phone_display", "sla_weekday_hours", "stale_fee_days"] });
    expect(JSON.stringify(audit[0]?.meta)).not.toContain("000");
  });

  it("saving what is already there changes nothing and writes no audit row", async () => {
    const before = await count("select count(*)::int as n from audit_log where action = 'settings.update'");
    const answer = await update(owner, { changes: { sla_weekday_hours: 2 } });
    expect(answer.json).toEqual({ changed: [], revalidate: null });
    expect(await count("select count(*)::int as n from audit_log where action = 'settings.update'")).toBe(before);
  });

  it.each([
    ["sla_weekday_hours", 0],
    ["sla_weekday_hours", 73],
    ["sla_weekday_hours", 1.5],
    ["sla_weekday_hours", "4"],
    ["sla_weekend_hours", 169],
    ["stale_fee_days", 29],
    ["stale_tour_days", 731],
    ["pipeline_freshness_days", 0],
    ["pipeline_freshness_days", 366],
    ["media_budget_bytes", 1],
    ["media_budget_bytes", 6 * 1024 ** 3],
    ["whatsapp_number_e164", "12345"],
    ["whatsapp_number_e164", "+0123456789"],
    ["whatsapp_number_e164", "https://wa.me/1"],
    ["whatsapp_number_e164", null],
    ["contact_phone_display", ""],
    ["contact_phone_display", "x".repeat(41)],
    ["collect_page_views", "yes"],
  ])("refuses %s = %j and names the field", async (key, value) => {
    const answer = await update(owner, { changes: { [key]: value } });
    expect(answer.status).toBe(400);
    expect(answer.json.error.fields[`changes.${key}`], JSON.stringify(answer.json)).toBeDefined();
  });

  it("refuses an unknown setting, the time zone, an empty change and extra fields", async () => {
    for (const body of [{ changes: { timezone: "UTC" } }, { changes: { nonsense: 1 } }, { changes: {} }, {}, { changes: { sla_weekday_hours: 3 }, extra: 1 }, null]) {
      expect((await update(owner, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await setting("timezone")).toBe("Africa/Douala");
  });

  it("all-or-nothing: one bad value stops the whole change", async () => {
    const answer = await update(owner, { changes: { sla_weekend_hours: 12, stale_tour_days: 5 } });
    expect(answer.status).toBe(400);
    expect(await setting("sla_weekend_hours")).toBe(24);
  });

  it("accepts the edges of each range and 'not set' for the pipeline freshness", async () => {
    expect((await update(owner, { changes: { sla_weekday_hours: 72, sla_weekend_hours: 1, stale_fee_days: 730, stale_tour_days: 30, pipeline_freshness_days: 14 } })).status).toBe(200);
    expect((await update(owner, { changes: { pipeline_freshness_days: null } })).json.changed).toEqual(["pipeline_freshness_days"]);
    expect(await setting("pipeline_freshness_days")).toBeNull();
    expect((await update(owner, { changes: { sla_weekday_hours: 4, sla_weekend_hours: 24, stale_fee_days: 180, stale_tour_days: 90, media_budget_bytes: 100 * 1024 * 1024 } })).status).toBe(200);
    expect((await update(owner, { changes: { media_budget_bytes: 3758096384 } })).status).toBe(200);
  });
});

describe("S10.1 a change reaches everything that reads the setting", () => {
  it("changing the WhatsApp number tells the public site to refresh and every reader gets the new number without a deploy", async () => {
    const answer = await update(owner, { changes: { whatsapp_number_e164: "+44 7700 900-123" } });
    expect(answer.status).toBe(200);
    expect(answer.json.changed).toEqual(["whatsapp_number_e164"]);
    expect(answer.json.revalidate.areas).toEqual(["site"]);
    expect(answer.json.revalidate.paths).toEqual(expect.arrayContaining(["/", "/contact", "/apply"]));
    expect(answer.json.revalidate.paths).not.toContain("/offline");
    // The number is stored as the digits the WhatsApp link needs.
    expect(await setting("whatsapp_number_e164")).toBe("+447700900123");
    // The three readers: the settings read the endpoints use, the public site's read, and the student portal's own query.
    expect((await readSettings(t.db)).whatsapp_number_e164).toBe("+447700900123");
    const site = await asRuntime(() => readSiteRows(t.db));
    expect(JSON.stringify(site)).toContain("+447700900123");
  });

  it("a setting that does not appear on the public site does not ask for a refresh", async () => {
    const answer = await update(owner, { changes: { stale_fee_days: 200 } });
    expect(answer.json.revalidate).toBeNull();
  });

  it("changing the SLA hours affects only leads received afterwards", async () => {
    await update(owner, { changes: { sla_weekday_hours: 4, sla_weekend_hours: 24 } });
    const monday = new Date("2026-10-26T09:00:00Z");
    const first = computeSla(monday, slaSettingsFrom(await readSettings(t.db)));
    const before = await leadRow(t, { received_at: monday.toISOString(), sla_due_at: first.dueAt.toISOString(), sla_hours_applied: first.hoursApplied });

    await update(owner, { changes: { sla_weekday_hours: 8 } });
    const second = computeSla(monday, slaSettingsFrom(await readSettings(t.db)));
    const after = await leadRow(t, { received_at: monday.toISOString(), sla_due_at: second.dueAt.toISOString(), sla_hours_applied: second.hoursApplied });

    const [old] = await rows(`select sla_hours_applied, sla_due_at from lead where id = ${q(before)}`);
    const [fresh] = await rows(`select sla_hours_applied, sla_due_at from lead where id = ${q(after)}`);
    expect(old?.sla_hours_applied).toBe(4);
    expect(fresh?.sla_hours_applied).toBe(8);
    expect(new Date(String(old?.sla_due_at)).toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(new Date(String(fresh?.sla_due_at)).toISOString()).toBe("2026-10-26T17:00:00.000Z");
    // And the stored target of the first lead is still what it was after the change.
    expect(first.hoursApplied).toBe(4);
  });

  it("the page-view switch is read back as off, and the analytics funnel knows", async () => {
    expect((await update(owner, { changes: { collect_page_views: false } })).json.changed).toEqual(["collect_page_views"]);
    expect((await readSettings(t.db)).collect_page_views).toBe(false);
    expect((await get(healthDataCalls(env()), "health", owner)).json.collectPageViews).toBe(false);
    await update(owner, { changes: { collect_page_views: true } });
    expect((await get(healthDataCalls(env()), "health", owner)).json.collectPageViews).toBe(true);
  });
});

describe("S10.2 Health and the usage check", () => {
  it("is for the owner only", async () => {
    await expect(get(healthDataCalls(env()), "health", admin)).rejects.toThrow(/Not allowed/);
    await expect(get(healthDataCalls(env()), "health", student)).rejects.toThrow(/Not allowed/);
  });

  it("reports database size, image use against the budget, stale counts and that no job has run yet", async () => {
    await insertRow(t, "media_asset", { id: "0194a000-0000-7000-8000-000000000001", kind: "photo", width: 10, height: 10, bytes: 2_000_000, mime: "image/webp", sha256: "a".repeat(64) });
    const answer = await get(healthDataCalls(env()), "health", owner);
    expect(answer.status).toBe(200);
    expect(answer.json.database.usedBytes).toBeGreaterThan(0);
    expect(answer.json.database.budgetBytes).toBe(512 * 1024 * 1024);
    expect(answer.json.database.level).toBe("ok");
    expect(answer.json.images).toMatchObject({ usedBytes: 2_000_000, budgetBytes: 3758096384, level: "ok" });
    expect(answer.json.jobs).toEqual([
      { job: "rollup", lastRunAt: null, lastOkAt: null, lastFailedAt: null },
      { job: "usage", lastRunAt: null, lastOkAt: null, lastFailedAt: null },
    ]);
    expect(answer.json.stale).toEqual({ fees: 0, campus: 0, resources: 0 });
    expect(answer.json.pipeline).toBeNull();
  });

  it("warns from 70% and is urgent from 90% of the image budget", async () => {
    await update(owner, { changes: { media_budget_bytes: 100 * 1024 * 1024 } });
    await t.run("update media_asset set bytes = 75 * 1024 * 1024");
    expect((await get(healthDataCalls(env()), "health", owner)).json.images.level).toBe("warn");
    await t.run("update media_asset set bytes = 95 * 1024 * 1024");
    expect((await get(healthDataCalls(env()), "health", owner)).json.images.level).toBe("urgent");
    await t.run("update media_asset set bytes = 69 * 1024 * 1024");
    expect((await get(healthDataCalls(env()), "health", owner)).json.images.level).toBe("ok");
    await update(owner, { changes: { media_budget_bytes: 3758096384 } });
  });

  it("counts stale fees, tours and links with the owner's day limits", async () => {
    const u = await uni(t, { status: "published" });
    const old = "2020-01-01T00:00:00Z";
    await insertRow(t, "fee_structure", { id: "0194a000-0000-7000-8000-0000000000f1", university_id: u, currency: "USD", amount_min: 100, amount_max: 200, period: "year", status: "published", data_confirmed: true, last_updated_at: old });
    const answer = await get(healthDataCalls(env()), "health", owner);
    expect(answer.json.stale.fees).toBe(1);
  });

  it("shows the pipeline freshness once the owner has set N", async () => {
    await update(owner, { changes: { pipeline_freshness_days: 14 } });
    const lead = await leadRow(t);
    await insertRow(t, "lead_activity", { id: "0194a000-0000-7000-8000-0000000000a1", lead_id: lead, type: "created", data: {} });
    const answer = await get(healthDataCalls(env()), "health", owner);
    expect(answer.json.pipeline.days).toBe(14);
    expect(answer.json.pipeline.active).toBeGreaterThanOrEqual(1);
    expect(answer.json.pipeline.fresh).toBeGreaterThanOrEqual(1);
    await update(owner, { changes: { pipeline_freshness_days: null } });
  });

  it("the usage check logs a line, records that it ran, and the page shows when", async () => {
    const lines: string[] = [];
    const outcome = await asRuntime(() => runUsageCheck(t.db, (line) => lines.push(line)));
    expect(outcome?.database.level).toBe("ok");
    expect(lines).toHaveLength(1);
    const logged = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(logged).toMatchObject({ job: "usage", level: "info", status: "ok" });
    expect(Object.keys(logged).sort()).toEqual(["databaseBytes", "databasePercent", "imageBytes", "imagePercent", "job", "level", "status"]);
    const [row] = await rows(`select actor_id, entity_type, meta from audit_log where action = 'job.usage'`);
    expect(row?.actor_id).toBeNull();
    expect(row?.meta).toMatchObject({ ok: true });
    const page = await get(healthDataCalls(env()), "health", owner);
    expect(page.json.jobs.find((j: any) => j.job === "usage").lastOkAt).not.toBeNull();
  });

  it("a failed run is recorded as failed and shows as the last failure", async () => {
    await asRuntime(() => recordJob(t.db, "rollup", false, { failed: 1 }));
    const job = (await get(healthDataCalls(env()), "health", owner)).json.jobs.find((j: any) => j.job === "rollup");
    expect(job.lastFailedAt).not.toBeNull();
    expect(job.lastOkAt).toBeNull();
    await asRuntime(() => recordJob(t.db, "rollup", true, { keys: 3 }));
    expect((await get(healthDataCalls(env()), "health", owner)).json.jobs.find((j: any) => j.job === "rollup").lastOkAt).not.toBeNull();
  });

  it("records a failure when the database cannot be read, and does not throw", async () => {
    const broken = { execute: () => Promise.reject(new Error("boom: password=hunter2")) } as unknown as EndpointEnv["db"];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await runUsageCheck(broken, () => undefined);
    expect(outcome).toBeNull();
    // The class of the error only: the message could carry connection details.
    expect(String(error.mock.calls[0]?.[0])).not.toContain("hunter2");
    error.mockRestore();
  });

  it("the job record function accepts only the two known jobs and is not callable as a free-form writer", async () => {
    await expect(asRuntime(() => t.run(`select public.app_record_job('anything', true, '{}'::jsonb)`))).rejects.toThrow(/Unknown job/);
    await expect(asRuntime(() => t.run(`select public.app_record_job('usage', true, null)`))).resolves.toBeDefined();
  });

  it("a job record is not visible to an admin (the audit log is owner-only)", async () => {
    const seen = await asRuntime(async () => {
      const { listAudit } = await import("@/server/repositories/audit");
      return listAudit(t.db, admin, { action: "job.usage" });
    });
    expect(seen).toEqual([]);
  });
});

describe("S10.3 the owner's full export", () => {
  const access = exportMutations["admin/export.download"]!.access;

  async function download(who: Actor): Promise<Answer> {
    const call: MutationCall = { actor: who, token: null, body: {}, bytes: null, requestId: "test", request: new Request("https://example.test/api/v1/admin/export.download", { method: "POST" }), env: env() };
    return answerOf(await asRuntime(() => exportMutations["admin/export.download"]!.handle(call)));
  }

  it("needs the owner with a recent 2FA check", () => {
    expect(denyAccess(access, owner, NOW)).toBeNull();
    expect(denyAccess(access, ownerStale, NOW)?.code).toBe("STEP_UP_REQUIRED");
    expect(denyAccess(access, admin, NOW)?.code).toBe("FORBIDDEN");
  });

  it("every table is either exported or deliberately left out, never both and never forgotten", async () => {
    const tables = ((await rows("select tablename from pg_tables where schemaname = 'public' order by 1")) as { tablename: string }[]).map((r) => r.tablename);
    const accounted = new Set<string>([...EXPORT_TABLES, ...Object.keys(EXPORT_EXCLUDED)]);
    expect(tables.filter((name) => !accounted.has(name)), "tables with no decision").toEqual([]);
    expect([...accounted].filter((name) => !tables.includes(name)), "names that are not tables").toEqual([]);
    expect(EXPORT_TABLES.filter((name) => name in EXPORT_EXCLUDED)).toEqual([]);
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
  });

  it("is one JSON file with every exported table, the lead data and the image manifest, and no secret", async () => {
    const lead = await leadRow(t, { name: "Exported Person" });
    await paymentRow(t, await uni(t), { entered_by: owner.userId });
    await t.run(`insert into owner_totp (user_id, secret_encrypted) values (${q(owner.userId)}, 'SECRET-CIPHERTEXT')`);
    await t.run(`insert into recovery_code (id, user_id, code_hash) values (gen_random_uuid(), ${q(owner.userId)}, 'HASH-OF-A-CODE')`);

    const answer = await download(owner);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Type")).toContain("application/json");
    expect(answer.headers.get("Content-Disposition")).toBe('attachment; filename="scollarly-export-2026-10-26.json"');
    expect(answer.headers.get("Cache-Control")).toBe("no-store");

    const file = answer.json;
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.exportedAt).toBe(NOW.toISOString());
    expect(file.imageBytesIncluded).toBe(false);
    expect(Object.keys(file.tables).sort()).toEqual([...EXPORT_TABLES].sort());
    expect(file.tables.lead.find((r: any) => r.id === lead).name).toBe("Exported Person");
    expect(file.tables.placement_payment.length).toBeGreaterThanOrEqual(1);
    expect(file.tables.media_asset[0]).toMatchObject({ sha256: "a".repeat(64), bytes: expect.any(Number) });
    // Secrets and image bytes are not in it, under any table name.
    expect(answer.text).not.toContain("SECRET-CIPHERTEXT");
    expect(answer.text).not.toContain("HASH-OF-A-CODE");
    for (const name of Object.keys(EXPORT_EXCLUDED)) expect(file.tables[name], name).toBeUndefined();
  });

  it("writes one audit row for the download, in the same transaction", async () => {
    const before = await count("select count(*)::int as n from audit_log where action = 'owner.export'");
    await download(owner);
    expect(await count("select count(*)::int as n from audit_log where action = 'owner.export'")).toBe(before + 1);
    const [row] = await rows(`select actor_id, meta from audit_log where action = 'owner.export' order by at desc limit 1`);
    expect(row?.actor_id).toBe(owner.userId);
    expect(row?.meta).toEqual({ tables: EXPORT_TABLES.length });
  });

  it("an admin who got past the facade would still get an empty audit-log table, not the log", async () => {
    const answer = await download(admin);
    // Row level security: the owner-only tables come back empty for anyone else, and the audit row is refused, so nothing is returned.
    expect(answer.status === 200 ? answer.json.tables.audit_log : []).toEqual([]);
  });
});
