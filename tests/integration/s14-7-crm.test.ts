/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read nested JSON answers; typing every shape would hide what each test checks */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crmDataCalls } from "@/modules/crm/endpoints";
import { readCrmFilters } from "@/modules/crm/filters";
import { type Actor, mintActor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { BOARD_COLUMN_LIMIT, crmOverview, exportLeads, pipelineBoard } from "@/server/repositories/crm";
import { createTestDb, type TestDb } from "./helpers/db";
import { leadRow, q } from "./helpers/fixtures";

/**
 * S14.7 against a real database, as the non-owner runtime role (ADR-038): the CRM overview, the pipeline board and the export count only live
 * leads, follow every filter, never carry a name, number or email into the file, are refused to a student by row level security as well as by the
 * facade, and the export leaves an audit row with the filters and the count.
 */

let t: TestDb;
let admin: Actor;
let owner: Actor;
let student: Actor;
// 2026-10-26 12:00 UTC is 13:00 WAT.
const NOW = new Date("2026-10-26T12:00:00Z");
const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => NOW });
const filters = (query = "") => {
  const read = readCrmFilters(new URLSearchParams(query), NOW);
  if (!read.ok) throw new Error(JSON.stringify(read.fields));
  return read.filters;
};

async function actorOf(role: "admin" | "owner" | "student"): Promise<Actor> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(user.userId)}, ${q(role)}, now())`);
  return mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: role, role, twoFactorVerifiedAt: role === "owner" ? new Date() : null });
}

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

async function call(name: string, actor: Actor, query = ""): Promise<{ status: number; json: any; response?: Response }> {
  const fn = crmDataCalls(env())[`admin/${name}`] as DataCall;
  const result = await asRuntime(() => fn(actor, { token: null, url: new URL(`https://example.test/api/v1/admin/${name}${query}`) }));
  if (result instanceof Response) {
    const isJson = (result.headers.get("content-type") ?? "").includes("json");
    return { status: result.status, json: isJson ? await result.clone().json() : null, response: result };
  }
  return { status: 200, json: JSON.parse(JSON.stringify(result)) };
}

const at = (iso: string) => ({ received_at: iso, sla_due_at: new Date(new Date(iso).getTime() + 4 * 3_600_000).toISOString() });
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeAll(async () => {
  t = await createTestDb();
  admin = await actorOf("admin");
  owner = await actorOf("owner");
  student = await actorOf("student");

  // Inside the last 30 days: 3 from Cameroon (one answered fast, one at a later stage), 2 from Nigeria, one assigned to the admin.
  await leadRow(t, { ...at(day(1)), country_code: "CM", source: { page: "/apply" }, first_response_at: new Date(new Date(day(1)).getTime() + 30 * 60_000).toISOString(), assigned_admin_id: admin.userId });
  await leadRow(t, { ...at(day(2)), country_code: "CM", source: { page: "onboarding" }, stage_code: "visa" });
  await leadRow(t, { ...at(day(3)), country_code: "CM", source: { page: "/apply" } });
  await leadRow(t, { ...at(day(4)), country_code: "NG", source: { page: "/" } });
  await leadRow(t, { ...at(day(5)), country_code: "NG", source: {}, stage_code: "arrived" });
  // The 30 days before that: two leads, for the comparison.
  await leadRow(t, { ...at(day(35)), country_code: "CM", source: { page: "/apply" } });
  await leadRow(t, { ...at(day(40)), country_code: "NG", source: { page: "/apply" } });
  // Never counted: a merged lead and an erased one.
  const primary = await leadRow(t, { ...at(day(6)), country_code: "CM" });
  await leadRow(t, { ...at(day(6)), country_code: "CM", merged_into_id: primary });
  await leadRow(t, { ...at(day(7)), country_code: "CM", anonymised_at: day(1), name: null, whatsapp_e164: null, email: null });
});

afterAll(async () => {
  await t.close();
});

describe("the overview counts live leads, in the range and the period before", () => {
  it("counts this period and the one before, and does not count merged or erased leads", async () => {
    const data = await asRuntime(() => crmOverview(t.db, admin, filters()));
    // 5 + the primary of the merge (it is live) = 6 in this period; the merged copy and the erased lead are not counted.
    expect(data.current.leads).toBe(6);
    expect(data.previous.leads).toBe(2);
    expect(data.current.answered).toBe(1);
    expect(data.current.avgFirstResponseMinutes).toBeCloseTo(30, 0);
    expect(data.previous.avgFirstResponseMinutes).toBeNull();
    expect(data.arrived).toBe(1);
    expect(data.overdue).toBeGreaterThan(0);
  });

  it("splits by stage, day, country and source", async () => {
    const data = await asRuntime(() => crmOverview(t.db, admin, filters()));
    expect(data.stages.reduce((sum, s) => sum + s.count, 0)).toBe(6);
    expect(data.stages.find((s) => s.code === "visa")?.count).toBe(1);
    expect(data.days.reduce((sum, d) => sum + d.n, 0)).toBe(6);
    expect(Object.fromEntries(data.countries.map((c) => [c.key, c.count]))).toEqual({ CM: 4, NG: 2 });
    expect(Object.fromEntries(data.sources.map((s) => [s.key, s.count]))).toMatchObject({ "/apply": 2, onboarding: 1, "/": 1, unknown: 2 });
  });
});

describe("every filter narrows what is counted", () => {
  it("country, source and assigned", async () => {
    const cm = await asRuntime(() => crmOverview(t.db, admin, filters("country=CM")));
    expect(cm.current.leads).toBe(4);
    const apply = await asRuntime(() => crmOverview(t.db, admin, filters("source=%2Fapply")));
    expect(apply.current.leads).toBe(2);
    const mine = await asRuntime(() => crmOverview(t.db, admin, filters("assigned=me")));
    expect(mine.current.leads).toBe(1);
    const nobody = await asRuntime(() => crmOverview(t.db, admin, filters("assigned=unassigned")));
    expect(nobody.current.leads).toBe(5);
  });

  it("the date range, and the comparison moves with it", async () => {
    const early = await asRuntime(() => crmOverview(t.db, admin, filters("from=2026-09-16&to=2026-09-25")));
    expect(early.current.leads).toBe(2);
  });
});

describe("the data calls", () => {
  it("answers the overview with percentages, a funnel and the filters echoed", async () => {
    const { status, json } = await call("crm", admin);
    expect(status).toBe(200);
    expect(json.totals).toMatchObject({ leads: 6, previousLeads: 2, answered: 1, answeredPercent: 17, arrived: 1 });
    expect(json.series).toHaveLength(30);
    expect(json.series.reduce((sum: number, p: { value: number }) => sum + p.value, 0)).toBe(6);
    expect(json.funnel[0]).toMatchObject({ code: "share_results", reached: 6, ofAll: 100 });
    expect(json.funnel.at(-1)).toMatchObject({ code: "arrived", reached: 1 });
    expect(json.filters).toEqual({ country: null, source: null, assigned: "all" });
  });

  it("shows every adviser's numbers to the owner only", async () => {
    expect((await call("crm", admin)).json.admins).toBeNull();
    const asOwner = (await call("crm", owner)).json.admins;
    expect(Array.isArray(asOwner)).toBe(true);
    expect(asOwner.find((a: any) => a.userId === admin.userId)).toMatchObject({ assigned: 1, answered: 1 });
  });

  it("names the field of a filter the screen could not have produced", async () => {
    const bad = await call("crm", admin, "?country=XX&assigned=everyone");
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields).toMatchObject({ country: expect.any(String), assigned: expect.any(String) });
  });
});

describe("a student gets nothing, from the database as well as the facade", () => {
  it("counts no lead for a student-level actor", async () => {
    const data = await asRuntime(() => crmOverview(t.db, student, filters()));
    expect(data.current.leads).toBe(0);
    const board = await asRuntime(() => pipelineBoard(t.db, student, filters(), NOW));
    expect(board.reduce((sum, c) => sum + c.total, 0)).toBe(0);
  });
});

describe("the pipeline board", () => {
  it("has a column per stage with the total and the newest cards, and carries the version a stage change needs", async () => {
    const columns = await asRuntime(() => pipelineBoard(t.db, admin, filters(), NOW));
    expect(columns.map((c) => c.code)).toEqual(["share_results", "choose_course", "offer_letter", "confirm_admission", "visa", "arrived"]);
    const first = columns.find((c) => c.code === "share_results");
    expect(first?.total).toBe(6);
    expect(first?.cards.length).toBeLessThanOrEqual(BOARD_COLUMN_LIMIT);
    expect(first?.cards[0]?.version).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(columns.find((c) => c.code === "visa")?.cards).toHaveLength(1);
  });

  it("does not use the date range: an old lead still waiting is on the board", async () => {
    const columns = await asRuntime(() => pipelineBoard(t.db, admin, filters("from=2026-10-20&to=2026-10-25"), NOW));
    expect(columns.find((c) => c.code === "share_results")?.total).toBe(6);
  });

  it("shows at most one screenful per column and still counts the rest", async () => {
    for (let i = 0; i < BOARD_COLUMN_LIMIT + 3; i += 1) await leadRow(t, { ...at(day(10 + i)), country_code: "GH", stage_code: "offer_letter" });
    const columns = await asRuntime(() => pipelineBoard(t.db, admin, filters("country=GH"), NOW));
    const column = columns.find((c) => c.code === "offer_letter");
    expect(column?.total).toBe(BOARD_COLUMN_LIMIT + 3);
    expect(column?.cards).toHaveLength(BOARD_COLUMN_LIMIT);
  });

  it("narrows by country and assigned", async () => {
    const mine = await asRuntime(() => pipelineBoard(t.db, admin, filters("assigned=me"), NOW));
    expect(mine.reduce((sum, c) => sum + c.total, 0)).toBe(1);
  });
});

describe("the export", () => {
  it("holds references and timing only, newest first, and no name, number or email", async () => {
    const { rows, truncated } = await asRuntime(() => exportLeads(t.db, admin, filters("from=2026-10-20"), NOW));
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(6);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["assigned", "country", "firstResponseMinutes", "intake", "overdue", "receivedAt", "ref", "source", "stage"]);
    expect(JSON.stringify(rows)).not.toMatch(/Test Student|\+2376|@/);
    expect((rows[0]?.receivedAt ?? "") >= (rows.at(-1)?.receivedAt ?? "")).toBe(true);
  });

  it("answers a CSV file with the right headers, and records who took it and with which filters", async () => {
    const before = ((await t.run(`select count(*)::int as n from audit_log where action = 'leads.exported'`)) as { n: number }[])[0]?.n ?? 0;
    const result = await call("export", admin, "?country=CM&from=2026-10-20");
    expect(result.status).toBe(200);
    const response = result.response as Response;
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the byte order mark, so a spreadsheet opens it as UTF-8
    const text = await response.text();
    expect(text.startsWith("reference,received_at_utc,stage,country,source,intake,assigned,first_response_minutes,overdue")).toBe(true);
    expect(text.trim().split("\r\n")).toHaveLength(1 + 4);
    const audit = (await t.run(`select actor_id, meta from audit_log where action = 'leads.exported' order by id desc limit 1`)) as { actor_id: string; meta: any }[];
    expect(((await t.run(`select count(*)::int as n from audit_log where action = 'leads.exported'`)) as { n: number }[])[0]?.n).toBe(before + 1);
    expect(audit[0]?.actor_id).toBe(admin.userId);
    expect(audit[0]?.meta).toMatchObject({ rows: 4, truncated: false, country: "CM", from: "2026-10-20" });
  });

  it("refuses a bad filter without writing an audit row", async () => {
    const before = ((await t.run(`select count(*)::int as n from audit_log where action = 'leads.exported'`)) as { n: number }[])[0]?.n ?? 0;
    expect((await call("export", admin, "?from=nonsense")).status).toBe(400);
    expect(((await t.run(`select count(*)::int as n from audit_log where action = 'leads.exported'`)) as { n: number }[])[0]?.n).toBe(before);
  });
});
