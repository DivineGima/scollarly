/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read nested JSON answers (`json.funnel.find(...)`); typing every shape would hide what each test checks */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyticsDataCalls } from "@/modules/analytics/endpoints";
import { runDailyRollup } from "@/modules/analytics/rollup";
import { type Actor, mintActor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { funnelData, performanceOf } from "@/server/repositories/analytics";
import { rollRawEvents, saveAggregateRows } from "@/server/repositories/rollup";
import { createTestDb, type TestDb } from "./helpers/db";
import { insertRow, leadRow, q, uni } from "./helpers/fixtures";

/**
 * Stage 7 against a real database, as the non-owner runtime role (ADR-038): the daily rollup (WAT date boundaries, counted exactly
 * once, purged after 30 days), the funnel and sources (reconciled with the lead and stage data), the kill switch notice, and the
 * admin's own numbers. The exit criteria of Stage 7 are each a test here or in tests/unit/stage7-pure.test.ts.
 */

let t: TestDb;
let admin: Actor;
let admin2: Actor;
let student: Actor;
let universityA = "";
let universityB = "";
// 2026-10-26 12:00 UTC is 13:00 WAT, Monday.
const NOW = new Date("2026-10-26T12:00:00Z");

const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => NOW });

async function actorOf(role: "admin" | "student"): Promise<Actor> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role) values (${q(user.userId)}, ${q(role)})`);
  return mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: role, role, twoFactorVerifiedAt: null });
}

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

async function get(name: string, actor: Actor, query = ""): Promise<{ status: number; json: Record<string, any> }> {
  const call = analyticsDataCalls(env())[`admin/${name}`] as DataCall;
  const result = await asRuntime(() => call(actor, { token: null, url: new URL(`https://example.test/api/v1/admin/${name}${query}`) }));
  if (result instanceof Response) return { status: result.status, json: (await result.json()) as Record<string, any> };
  return { status: 200, json: JSON.parse(JSON.stringify(result)) as Record<string, any> };
}

const rows = (sql: string) => t.run(sql) as Promise<Record<string, unknown>[]>;
const agg = (where = "true") => rows(`select date::text as date, type, country, page_group, count::int as count from event_daily_agg where ${where} order by date, type, country nulls first`);

beforeAll(async () => {
  t = await createTestDb();
  admin = await actorOf("admin");
  admin2 = await actorOf("admin");
  student = await actorOf("student");
  universityA = await uni(t, { status: "published", name: "Alpha University" });
  universityB = await uni(t, { status: "published", name: "Beta University" });
});

afterAll(async () => {
  await t.close();
});

describe("S7.1 the daily rollup", () => {
  it("adds the collector's counts to the daily table, and again on a second run", async () => {
    const row = { date: "2026-10-25", type: "page_view", country: "CM", universityId: null, pageGroup: "home", count: 7 };
    await asRuntime(() => saveAggregateRows(t.db, [row, { ...row, country: "NG", count: 3 }, { ...row, universityId: universityA, pageGroup: "university", count: 2 }]));
    expect(await agg("type = 'page_view'")).toEqual([
      { date: "2026-10-25", type: "page_view", country: "CM", page_group: "home", count: 7 },
      { date: "2026-10-25", type: "page_view", country: "CM", page_group: "university", count: 2 },
      { date: "2026-10-25", type: "page_view", country: "NG", page_group: "home", count: 3 },
    ]);
    await asRuntime(() => saveAggregateRows(t.db, [row]));
    expect((await agg("type = 'page_view' and country = 'CM' and page_group = 'home'"))[0]?.count).toBe(14);
  });

  it("stores an unknown university as 'none' instead of failing the batch", async () => {
    await asRuntime(() => saveAggregateRows(t.db, [{ date: "2026-10-24", type: "install", country: null, universityId: randomUUID(), pageGroup: null, count: 1 }]));
    const [stored] = await rows("select university_id from event_daily_agg where type = 'install'");
    expect(stored?.university_id).toBeNull();
  });

  it("does nothing for an empty batch and refuses nothing it did not write", async () => {
    await asRuntime(() => saveAggregateRows(t.db, []));
    await expect(asRuntime(() => saveAggregateRows(t.db, [{ date: "2026-10-24", type: "bogus", country: null, universityId: null, pageGroup: null, count: 1 }]))).rejects.toThrow();
  });

  it("counts a raw tap for the WAT day it happened on: 23:30 WAT is that day, 00:30 WAT is the next", async () => {
    const tap = (receivedAt: string, country = "GH") => insertRow(t, "event", { id: randomUUID(), type: "wa_tap", lead_ref: "SC-AAAAA-AAAAA", country, page_group: "home", received_at: receivedAt });
    await tap("2026-10-20T22:30:00Z"); // 23:30 WAT on the 20th
    await tap("2026-10-20T23:30:00Z"); // 00:30 WAT on the 21st
    await tap("2026-10-21T10:00:00Z");
    await tap("2026-10-26T09:00:00Z"); // today (WAT), not counted yet
    const first = await asRuntime(() => rollRawEvents(t.db, "2026-10-26"));
    expect(first.counted).toBe(3);
    const taps = await agg("type = 'wa_tap' and country = 'GH'");
    expect(taps).toEqual([
      { date: "2026-10-20", type: "wa_tap", country: "GH", page_group: "home", count: 1 },
      { date: "2026-10-21", type: "wa_tap", country: "GH", page_group: "home", count: 2 },
    ]);
  });

  it("counts every raw row once, even when the job runs again", async () => {
    const again = await asRuntime(() => rollRawEvents(t.db, "2026-10-26"));
    expect(again.counted).toBe(0);
    expect((await agg("type = 'wa_tap' and country = 'GH' and date = '2026-10-21'"))[0]?.count).toBe(2);
    // The next day the tap from "today" is a whole day behind and gets counted.
    const next = await asRuntime(() => rollRawEvents(t.db, "2026-10-27"));
    expect(next.counted).toBe(1);
    expect((await agg("type = 'wa_tap' and country = 'GH' and date = '2026-10-26'"))[0]?.count).toBe(1);
  });

  it("purges rows 30 days after they were counted, and not before", async () => {
    expect(Number((await rows("select count(*)::int as n from event"))[0]?.n)).toBe(4);
    await t.run("update event set rolled_up_at = now() - interval '29 days' where received_at < '2026-10-21T00:00:00Z'");
    const early = await asRuntime(() => rollRawEvents(t.db, "2026-10-27"));
    expect(early.purged).toBe(0);
    await t.run("update event set rolled_up_at = now() - interval '31 days' where received_at < '2026-10-21T00:00:00Z'");
    const later = await asRuntime(() => rollRawEvents(t.db, "2026-10-27"));
    expect(later.purged).toBe(2);
    expect(Number((await rows("select count(*)::int as n from event"))[0]?.n)).toBe(2);
    // The daily counts are what stays.
    expect((await agg("type = 'wa_tap' and country = 'GH'")).reduce((sum, r) => sum + Number(r.count), 0)).toBe(4);
  });

  it("the event table and the daily table hold nothing that identifies a person", async () => {
    const columns = (await rows(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('event', 'event_daily_agg')",
    )) as { table_name: string; column_name: string }[];
    const names = columns.map((c) => c.column_name);
    for (const forbidden of ["name", "email", "phone", "whatsapp", "whatsapp_e164", "ip", "ip_address", "user_agent"]) expect(names, forbidden).not.toContain(forbidden);
  });

  it("the whole job: drains the collector, saves, rolls the raw rows, and puts the counts back if saving fails", async () => {
    let stored: Record<string, number> = { [`agg:2026-10-25:page_view:CM:-:home`]: 5, "agg:garbage": 1 };
    let saves = 0;
    const deps = (fail: boolean) => ({
      drain: async () => {
        const out = stored;
        stored = {};
        return out;
      },
      restore: async (back: Record<string, number>) => {
        stored = { ...stored, ...back };
      },
      saveCounts: async (r: Parameters<typeof saveAggregateRows>[1]) => {
        saves += 1;
        if (fail) throw new Error("neon down");
        await asRuntime(() => saveAggregateRows(t.db, r));
      },
      rollRaw: (day: string) => asRuntime(() => rollRawEvents(t.db, day)),
      now: () => NOW,
    });
    const failed = await runDailyRollup(deps(true));
    expect(failed.failed).toEqual(["counts"]);
    expect(Object.keys(stored)).toContain("agg:2026-10-25:page_view:CM:-:home");
    const ok = await runDailyRollup(deps(false));
    expect(ok).toMatchObject({ failed: [], rows: 1, skipped: 1 });
    expect(saves).toBe(2);
    expect(stored).toEqual({});
  });
});

describe("S7.2 the funnel and the sources", () => {
  const at = (days: number, hour = 9) => new Date(Date.UTC(2026, 9, 26 - days, hour)).toISOString();

  beforeAll(async () => {
    // Five leads in the last 30 days, one old, one merged, across stages, countries, universities and pages.
    await leadRow(t, { received_at: at(1), country_code: "CM", stage_code: "share_results", source: { page: "/universities/alpha", university_id: universityA } });
    await leadRow(t, { received_at: at(2), country_code: "CM", stage_code: "choose_course", source: { page: "/apply", university_id: universityA } });
    await leadRow(t, { received_at: at(3), country_code: "NG", stage_code: "offer_letter", source: { page: "/apply", university_id: universityB } });
    await leadRow(t, { received_at: at(4), country_code: "NG", stage_code: "arrived", source: { page: "/", university_id: universityB } });
    await leadRow(t, { received_at: at(5), country_code: "GH", stage_code: "visa", source: {} });
    await leadRow(t, { received_at: at(60), country_code: "GH", stage_code: "arrived", source: {} }); // outside the range
    const keep = await leadRow(t, { received_at: at(6), country_code: "CM", stage_code: "share_results", source: { university_id: universityA } });
    await leadRow(t, { received_at: at(6), country_code: "CM", stage_code: "share_results", source: { university_id: universityA }, merged_into_id: keep }); // a duplicate
    await asRuntime(() =>
      saveAggregateRows(t.db, [
        { date: "2026-10-20", type: "page_view", country: "CM", universityId: universityA, pageGroup: "university", count: 100 },
        { date: "2026-10-21", type: "page_view", country: "NG", universityId: universityB, pageGroup: "university", count: 50 },
        { date: "2026-10-21", type: "wa_tap", country: "NG", universityId: universityB, pageGroup: "university", count: 10 },
        { date: "2026-08-01", type: "page_view", country: "CM", universityId: null, pageGroup: "home", count: 999 }, // outside the range
      ]),
    );
  });

  it("reconciles the funnel with the leads and their stages", async () => {
    const { status, json } = await get("analytics", admin);
    expect(status).toBe(200);
    expect(json.range).toEqual({ from: "2026-09-27", to: "2026-10-26" });
    const count = (key: string) => json.funnel.find((r: { key: string }) => r.key === key)?.count;
    const visits = 100 + 50 + 7 + 3 + 2 + 7 + 3; // the page-view rows of the rollup tests above, all inside the range
    expect(count("visit")).toBeGreaterThanOrEqual(150);
    expect(count("visit")).toBeLessThanOrEqual(visits + 150);
    expect(count("lead")).toBe(6);
    expect(json.totalLeads).toBe(6);
    // A stage's count is the leads that reached it (at it or later), so the counts only fall.
    expect(count("stage:choose_course")).toBe(4);
    expect(count("stage:offer_letter")).toBe(3);
    expect(count("stage:confirm_admission")).toBe(2);
    expect(count("stage:visa")).toBe(2);
    expect(count("stage:arrived")).toBe(1);
    const counts = json.funnel.filter((r: { key: string }) => r.key.startsWith("stage:")).map((r: { count: number }) => r.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // The drop-off is the share kept from the step before.
    const choose = json.funnel.find((r: { key: string }) => r.key === "stage:choose_course");
    expect(choose.ratio).toBeCloseTo(4 / 6, 5);
    expect(choose.label).toBe("Choose course");
    expect(json.funnel[0].ratio).toBeNull();
  });

  it("the sources add up to the same leads", async () => {
    const { json } = await get("analytics", admin);
    const sum = (list: { leads: number }[]) => list.reduce((s, r) => s + r.leads, 0);
    expect(sum(json.sources.byCountry)).toBe(6);
    expect(sum(json.sources.byUniversity)).toBe(6);
    expect(sum(json.sources.byPage)).toBe(6);
    expect(json.sources.byCountry[0]).toEqual({ country: "CM", leads: 3 });
    expect(json.sources.byUniversity.find((u: { name: string | null }) => u.name === "Alpha University").leads).toBe(3);
    expect(json.sources.byUniversity.find((u: { name: string | null }) => u.name === null).leads).toBe(1);
  });

  it("filters by country and university, for the leads and the counts alike", async () => {
    const ng = (await get("analytics", admin, "?country=NG")).json;
    expect(ng.funnel.find((r: { key: string }) => r.key === "lead").count).toBe(2);
    // 50 from this describe block and 3 from the rollup test above.
    expect(ng.funnel.find((r: { key: string }) => r.key === "visit").count).toBe(53);
    expect(ng.funnel.find((r: { key: string }) => r.key === "wa_tap").count).toBe(10);
    const a = (await get("analytics", admin, `?university=${universityA}`)).json;
    expect(a.funnel.find((r: { key: string }) => r.key === "lead").count).toBe(3);
    expect(a.funnel.find((r: { key: string }) => r.key === "visit").count).toBe(100 + 2);
  });

  it("uses WAT dates for both the counts and the leads", async () => {
    // 22:30 UTC is 23:30 WAT on the 26th: it counts for the 26th. 23:30 UTC is 00:30 WAT on the 27th: outside a range that ends on the 26th.
    await leadRow(t, { received_at: "2026-10-26T22:30:00Z", country_code: "ZA", source: {} });
    await leadRow(t, { received_at: "2026-10-26T23:30:00Z", country_code: "ZA", source: {} });
    const day = (await get("analytics", admin, "?from=2026-10-26&to=2026-10-26&country=ZA")).json;
    expect(day.funnel.find((r: { key: string }) => r.key === "lead").count).toBe(1);
    const range = (await get("analytics", admin, "?from=2026-10-26&to=2026-10-26")).json;
    expect(range.totalLeads).toBe(1);
  });

  it("refuses a range the screen could not have produced, naming the field", async () => {
    for (const [query, field, token] of [
      ["?from=2026-10-30&to=2026-10-31", "to", "FUTURE"],
      ["?from=2026-10-20&to=2026-10-10", "from", "ORDER"],
      ["?from=2024-01-01&to=2026-10-26", "from", "TOO_LONG"],
      ["?from=2026-02-30", "from", "INVALID"],
      ["?from=yesterday", "from", "INVALID"],
      ["?country=XX", "country", "UNKNOWN_VALUE"],
      ["?university=nope", "university", "INVALID"],
      ["?other=1", "query", "Unrecognized"],
    ] as const) {
      const { status, json } = await get("analytics", admin, query);
      expect(status, query).toBe(400);
      expect(json.error.fields[field], query).toContain(token);
    }
  });

  it("shows no visit step, and says so, when page views are switched off", async () => {
    await t.run("update site_setting set value = 'false'::jsonb where key = 'collect_page_views'");
    const { json } = await get("analytics", admin);
    expect(json.collectPageViews).toBe(false);
    expect(json.funnel.map((r: { key: string }) => r.key)).not.toContain("visit");
    expect(json.funnel[0].key).toBe("wa_tap");
    expect(json.funnel[0].ratio).toBeNull();
    await t.run("update site_setting set value = 'true'::jsonb where key = 'collect_page_views'");
    expect((await get("analytics", admin)).json.collectPageViews).toBe(true);
  });

  it("a student sees nothing, whatever calls the function (row level security)", async () => {
    const data = await asRuntime(() => funnelData(t.db, student, { from: "2026-09-27", to: "2026-10-26", start: new Date("2026-09-26T23:00:00Z"), end: new Date("2026-10-26T23:00:00Z") }));
    expect(data.pageViews).toBe(0);
    expect(data.leadsByStage.size).toBe(0);
    expect(data.byCountry).toEqual([]);
  });
});

describe("S7.3 my performance", () => {
  const range = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") };
  const minutes = (n: number) => new Date(Date.UTC(2026, 9, 10, 9, n)).toISOString();

  beforeAll(async () => {
    const base = { received_at: minutes(0), country_code: "CM" };
    await leadRow(t, { ...base, assigned_admin_id: admin.userId, first_response_at: minutes(10), sla_due_at: minutes(240) });
    await leadRow(t, { ...base, assigned_admin_id: admin.userId, first_response_at: minutes(30), sla_due_at: minutes(240) });
    await leadRow(t, { ...base, assigned_admin_id: admin.userId, first_response_at: minutes(80), sla_due_at: minutes(240) });
    await leadRow(t, { ...base, assigned_admin_id: admin.userId, sla_due_at: minutes(240) }); // unanswered and past its target
    await leadRow(t, { ...base, assigned_admin_id: admin.userId, sla_due_at: "2026-12-01T00:00:00Z" }); // unanswered, not due yet
    await leadRow(t, { ...base, assigned_admin_id: admin2.userId, first_response_at: minutes(5), sla_due_at: minutes(240) });
    await leadRow(t, { ...base, sla_due_at: minutes(240) }); // unassigned
  });

  it("counts only the signed-in admin's own leads, answers and overdue", async () => {
    const mine = await asRuntime(() => performanceOf(t.db, admin, range, NOW));
    expect(mine).toMatchObject({ assigned: 5, answered: 3, medianMinutes: 30, overdue: 1 });
    expect(mine.meanMinutes).toBe(40);
    const theirs = await asRuntime(() => performanceOf(t.db, admin2, range, NOW));
    expect(theirs).toMatchObject({ assigned: 1, answered: 1, medianMinutes: 5, meanMinutes: 5, overdue: 0 });
  });

  it("has no times when nothing was answered, and none for someone with no leads", async () => {
    const none = await asRuntime(() => performanceOf(t.db, student, range, NOW));
    expect(none).toEqual({ assigned: 0, answered: 0, medianMinutes: null, meanMinutes: null, overdue: 0 });
  });

  it("takes the person from the session: the call has no way to ask for another admin", async () => {
    const answer = await get("performance", admin, `?from=2026-10-01&to=2026-10-26`);
    expect(answer.status).toBe(200);
    expect(answer.json.assigned).toBe(5);
    const other = await get("performance", admin, `?admin=${admin2.userId}`);
    expect(other.status).toBe(400);
  });
});
