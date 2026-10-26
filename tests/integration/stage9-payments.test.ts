/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read nested JSON answers; typing every shape would hide what each test checks */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/uuid";
import { analyticsDataCalls } from "@/modules/analytics/endpoints";
import { paymentDataCalls, paymentMutations } from "@/modules/payments/endpoints";
import { AuthError, type Actor, mintActor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { MutationCall } from "@/server/edge/mutations";
import { runAs } from "@/server/repositories/as-actor";
import { eraseLead } from "@/server/repositories/lead-admin";
import { listPayments, recordPayment, searchLeadsForPayment, voidPayment } from "@/server/repositories/payments";
import { createTestDb, type TestDb } from "./helpers/db";
import { leadRow, paymentRow, q, uni } from "./helpers/fixtures";

/**
 * Stage 9 against a real database, as the non-owner runtime role (ADR-038): the payments ledger (S9.1, S9.2), its totals in analytics
 * (S9.3) and the all-admin performance view (S9.4). Each exit criterion of Stage 9 is a test here.
 */

let t: TestDb;
let admin: Actor;
let admin2: Actor;
let student: Actor;
let universityA = "";
let universityB = "";
// 2026-10-26 12:00 UTC is 13:00 WAT, Monday.
let now = new Date("2026-10-26T12:00:00Z");

const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => now });

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

interface Answer {
  status: number;
  json: Record<string, any>;
  text: string;
  headers: Headers;
}

/** The body as text with any byte order mark kept (`Response.text()` drops it, and the CSV must carry one). */
async function readText(response: Response): Promise<string> {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
}

async function post(operation: string, who: Actor, body: unknown): Promise<Answer> {
  const mutation = paymentMutations[`admin/${operation}`];
  if (!mutation) throw new Error(`no operation ${operation}`);
  const call: MutationCall = {
    actor: who,
    token: null,
    body,
    bytes: null,
    requestId: "test",
    request: new Request(`https://example.test/api/v1/admin/${operation}`, { method: "POST" }),
    env: env(),
  };
  const response = await asRuntime(() => mutation.handle(call));
  const text = await readText(response);
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text.replace(/^﻿/, "")) as Record<string, any>;
  } catch {
    // A CSV body is not JSON.
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function get(name: string, who: Actor, query = ""): Promise<Answer> {
  const call = paymentDataCalls(env())[`admin/${name}`] as DataCall;
  const result = await asRuntime(() => call(who, { token: null, url: new URL(`https://example.test/api/v1/admin/${name}${query}`) }));
  if (result instanceof Response) {
    const text = await readText(result);
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text) as Record<string, any>;
    } catch {
      // CSV.
    }
    return { status: result.status, json, text, headers: result.headers };
  }
  return { status: 200, json: JSON.parse(JSON.stringify(result)) as Record<string, any>, text: "", headers: new Headers() };
}

const rows = (statement: string) => t.run(statement) as Promise<Record<string, unknown>[]>;

/** The database error, wherever the driver put it: Drizzle wraps it as `cause`. */
async function refusedWith(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await work;
  } catch (error) {
    const e = error as { message?: string; cause?: { message?: string } };
    expect(`${e.message ?? ""} | ${e.cause?.message ?? ""}`).toMatch(pattern);
    return;
  }
  throw new Error("expected the database to refuse this, but it went through");
}
const count = async (statement: string) => Number((await rows(statement))[0]?.n);

const record = (who: Actor, over: Record<string, unknown> = {}) =>
  post("payments.record", who, { submissionToken: randomUUID(), universityId: universityA, amount: "1500.00", receivedOn: "2026-10-20", note: null, leadId: null, ...over });

beforeAll(async () => {
  t = await createTestDb();
  admin = await actorOf("admin");
  admin2 = await actorOf("admin");
  student = await actorOf("student");
  universityA = await uni(t, { status: "published", name: "Alpha University" });
  universityB = await uni(t, { status: "published", name: "=Beta University" });
});

afterAll(async () => {
  await t.close();
});

describe("S9.1 recording a payment", () => {
  it("stores whole US cents, the person who entered it and one audit row", async () => {
    const answer = await record(admin, { amount: "1,500.50", note: "First instalment" });
    expect(answer.status).toBe(201);
    const [row] = await rows(`select amount_usd_cents, entered_by, received_on::text as received_on, note, voided_at from placement_payment where id = ${q(answer.json.id)}`);
    expect(Number(row?.amount_usd_cents)).toBe(150050);
    expect(row?.entered_by).toBe(admin.userId);
    expect(row?.received_on).toBe("2026-10-20");
    expect(row?.note).toBe("First instalment");
    expect(row?.voided_at).toBeNull();
    const audit = await rows(`select actor_id, entity_type, meta from audit_log where action = 'payments.record' and entity_id = ${q(answer.json.id)}`);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_id).toBe(admin.userId);
    expect(audit[0]?.meta).toEqual({ university_id: universityA, amount_usd_cents: 150050 });
  });

  it("records one payment for a double tap and for a replay of the same submission token", async () => {
    const submissionToken = randomUUID();
    const first = await record(admin, { submissionToken, amount: "250" });
    const second = await record(admin, { submissionToken, amount: "250" });
    const third = await record(admin2, { submissionToken, amount: "250" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json).toEqual({ id: first.json.id, status: "replayed" });
    expect(third.json.id).toBe(first.json.id);
    expect(await count(`select count(*)::int as n from placement_payment where submission_token = ${q(submissionToken)}`)).toBe(1);
    expect(await count(`select count(*)::int as n from audit_log where action = 'payments.record' and entity_id = ${q(first.json.id)}`)).toBe(1);
  });

  it("refuses the same token with different facts instead of silently keeping the first", async () => {
    const submissionToken = randomUUID();
    await record(admin, { submissionToken, amount: "100" });
    const again = await record(admin, { submissionToken, amount: "999" });
    expect(again.status).toBe(409);
    expect(await count(`select count(*)::int as n from placement_payment where submission_token = ${q(submissionToken)}`)).toBe(1);
  });

  it.each(["0", "0.00", "-5", "+5", "12.345", "abc", "1e3", "", " ", "1,50", "$100", "100000001"])("rejects the amount %j", async (amount) => {
    const answer = await record(admin, { amount });
    expect(answer.status).toBe(400);
    expect(answer.json.error.fields.amount).toBeDefined();
  });

  it("accepts amounts written with a thousands comma, no decimals or one decimal", async () => {
    for (const [amount, cents] of [["2,000", 200000], ["7", 700], ["7.5", 750], ["0.01", 1]] as const) {
      const answer = await record(admin, { amount });
      expect(answer.status, amount).toBe(201);
      expect(Number((await rows(`select amount_usd_cents from placement_payment where id = ${q(answer.json.id)}`))[0]?.amount_usd_cents), amount).toBe(cents);
    }
  });

  it("rejects a date in the future and a date that does not exist, and accepts today", async () => {
    expect((await record(admin, { receivedOn: "2026-10-27" })).json.error.fields.receivedOn).toBe("FUTURE_DATE");
    expect((await record(admin, { receivedOn: "2026-02-30" })).json.error.fields.receivedOn).toBe("INVALID");
    expect((await record(admin, { receivedOn: "yesterday" })).status).toBe(400);
    expect((await record(admin, { receivedOn: "2026-10-26" })).status).toBe(201);
  });

  it("takes 'today' from the WAT calendar: 23:30 UTC is already tomorrow in Douala", async () => {
    const before = now;
    now = new Date("2026-10-26T23:30:00Z");
    try {
      expect((await record(admin, { receivedOn: "2026-10-27" })).status).toBe(201);
      expect((await record(admin, { receivedOn: "2026-10-28" })).status).toBe(400);
    } finally {
      now = before;
    }
  });

  it("refuses an unknown field, a missing token, an unknown university and an unknown lead", async () => {
    expect((await record(admin, { extra: 1 })).status).toBe(400);
    expect((await record(admin, { submissionToken: undefined })).status).toBe(400);
    expect((await record(admin, { submissionToken: "not-a-uuid" })).status).toBe(400);
    expect((await record(admin, { universityId: randomUUID() })).json.error.fields.universityId).toBe("UNKNOWN_VALUE");
    expect((await record(admin, { leadId: randomUUID() })).json.error.fields.leadId).toBe("UNKNOWN_VALUE");
    expect((await record(admin, { note: "x".repeat(501) })).status).toBe(400);
  });

  it("links a payment to a lead", async () => {
    const lead = await leadRow(t);
    const answer = await record(admin, { leadId: lead });
    expect(answer.status).toBe(201);
    expect((await rows(`select lead_id from placement_payment where id = ${q(answer.json.id)}`))[0]?.lead_id).toBe(lead);
  });

  it("a student cannot record or read payments: row level security refuses the insert and shows no row", async () => {
    await expect(
      asRuntime(() => recordPayment(t.db, student, { id: uuidv7(), submissionToken: randomUUID(), universityId: universityA, leadId: null, amountUsdCents: 100, receivedOn: "2026-10-20", note: null })),
    ).rejects.toThrow();
    const seen = await asRuntime(() => listPayments(t.db, student, {}));
    expect(seen.rows).toEqual([]);
    expect(seen.totals.grandTotalCents).toBe(0);
  });

  it("cannot be recorded as someone else: the policy requires entered_by to be the signed-in person", async () => {
    await expect(
      asRuntime(() => runAs(t.db, admin, t.db.execute(sql`insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by) values (${uuidv7()}::uuid, ${randomUUID()}::uuid, ${universityA}::uuid, 100, '2026-10-20', ${admin2.userId})`))),
    ).rejects.toThrow();
  });
});

describe("S9.1 voiding a payment", () => {
  it("needs a reason, sets the void fields and writes an audit row, and the row stays", async () => {
    const made = await record(admin, { amount: "40" });
    expect((await post("payments.void", admin2, { id: made.json.id })).status).toBe(400);
    expect((await post("payments.void", admin2, { id: made.json.id, reason: "   " })).status).toBe(400);
    expect((await post("payments.void", admin2, { id: made.json.id, reason: "x".repeat(301) })).status).toBe(400);
    expect((await post("payments.void", admin2, { id: made.json.id, reason: "Entered twice", extra: 1 })).status).toBe(400);
    expect(await count(`select count(*)::int as n from placement_payment where id = ${q(made.json.id)} and voided_at is null`)).toBe(1);

    const voided = await post("payments.void", admin2, { id: made.json.id, reason: "  Entered twice  " });
    expect(voided.status).toBe(200);
    const [row] = await rows(`select voided_by, void_reason, voided_at is not null as voided, amount_usd_cents from placement_payment where id = ${q(made.json.id)}`);
    expect(row).toMatchObject({ voided_by: admin2.userId, void_reason: "Entered twice", voided: true });
    expect(Number(row?.amount_usd_cents)).toBe(4000);
    expect(await count(`select count(*)::int as n from audit_log where action = 'payments.void' and entity_id = ${q(made.json.id)} and actor_id = ${q(admin2.userId)}`)).toBe(1);
  });

  it("cannot void twice, and an unknown payment is a 404", async () => {
    const made = await record(admin, { amount: "41" });
    expect((await post("payments.void", admin, { id: made.json.id, reason: "wrong" })).status).toBe(200);
    expect((await post("payments.void", admin, { id: made.json.id, reason: "again" })).status).toBe(409);
    expect((await post("payments.void", admin, { id: randomUUID(), reason: "wrong" })).status).toBe(404);
    expect(await count(`select count(*)::int as n from audit_log where action = 'payments.void' and entity_id = ${q(made.json.id)}`)).toBe(1);
  });

  it("a student cannot void: nothing changes", async () => {
    const made = await record(admin, { amount: "42" });
    const outcome = await asRuntime(() => voidPayment(t.db, student, made.json.id, "no"));
    expect(outcome).toBe("not_found");
    expect(await count(`select count(*)::int as n from placement_payment where id = ${q(made.json.id)} and voided_at is null`)).toBe(1);
  });
});

describe("S9.1 no update path exists except voiding", () => {
  let id = "";
  beforeAll(async () => {
    id = (await record(admin, { amount: "500" })).json.id;
  });

  const asAdmin = (statement: ReturnType<typeof sql>) => asRuntime(() => runAs(t.db, admin, t.db.execute(statement)));

  it.each([
    ["the amount", "amount_usd_cents = 1"],
    ["the university", `university_id = '${randomUUID()}'`],
    ["the date", "received_on = '2020-01-01'"],
    ["the note", "note = 'changed'"],
    ["who entered it", "entered_by = 'someone-else'"],
    ["the lead link", `lead_id = '${randomUUID()}'`],
    ["the token", `submission_token = '${randomUUID()}'`],
  ])("the runtime role cannot change %s: the column is not granted", async (_name, set) => {
    await refusedWith(asAdmin(sql.raw(`update placement_payment set ${set} where id = '${id}'`)), /permission denied/i);
  });

  it("even as the table owner the guard refuses an edit, a second void and a re-link", async () => {
    await expect(t.run(`update placement_payment set amount_usd_cents = 1 where id = ${q(id)}`)).rejects.toThrow(/cannot be edited/);
    await expect(t.run(`update placement_payment set note = 'x' where id = ${q(id)}`)).rejects.toThrow(/cannot be edited/);
    await expect(t.run(`update placement_payment set lead_id = ${q(randomUUID())} where id = ${q(id)}`)).rejects.toThrow(/cannot be linked/);
    await t.run(`update placement_payment set voided_at = now(), voided_by = 'x', void_reason = 'first' where id = ${q(id)}`);
    await expect(t.run(`update placement_payment set voided_at = now(), voided_by = 'y', void_reason = 'second' where id = ${q(id)}`)).rejects.toThrow(/voided payment cannot be changed/);
    await expect(t.run(`update placement_payment set void_reason = 'rewritten' where id = ${q(id)}`)).rejects.toThrow(/voided payment cannot be changed/);
    expect((await rows(`select void_reason from placement_payment where id = ${q(id)}`))[0]?.void_reason).toBe("first");
  });

  it("a void must be recorded as the person who made it (row level security)", async () => {
    const made = await record(admin, { amount: "501" });
    await refusedWith(asAdmin(sql`update placement_payment set voided_at = now(), voided_by = ${admin2.userId}, void_reason = 'pretend' where id = ${made.json.id}::uuid`), /row-level security/i);
    expect(await count(`select count(*)::int as n from placement_payment where id = ${q(made.json.id)} and voided_at is null`)).toBe(1);
  });

  it("the runtime role has no DELETE", async () => {
    await refusedWith(asAdmin(sql.raw(`delete from placement_payment where id = '${id}'`)), /permission denied/i);
  });

  it("erasure can still clear the link on a payment, voided or not", async () => {
    const lead = await leadRow(t);
    const made = await record(admin, { leadId: lead, amount: "502" });
    await post("payments.void", admin, { id: made.json.id, reason: "test" });
    await t.run(`update placement_payment set lead_id = null where id = ${q(made.json.id)}`);
    expect((await rows(`select lead_id from placement_payment where id = ${q(made.json.id)}`))[0]?.lead_id).toBeNull();
  });

  it("the erase-a-lead function clears the link and keeps the payment", async () => {
    const lead = await leadRow(t, { name: "Erase Me" });
    const made = await record(admin, { leadId: lead, amount: "503" });
    await asRuntime(() => eraseLead(t.db, admin, { leadId: lead, identityConfirmed: true }));
    const [row] = await rows(`select lead_id, amount_usd_cents from placement_payment where id = ${q(made.json.id)}`);
    expect(row?.lead_id).toBeNull();
    expect(Number(row?.amount_usd_cents)).toBe(50300);
  });
});

describe("S9.2 totals, the list and the filters", () => {
  let tt: TestDb;
  let a: Actor;
  let universityOne = "";
  let universityTwo = "";

  beforeAll(async () => {
    tt = await createTestDb();
    const user = await tt.signIn();
    await tt.run(`insert into app_user (id, role) values (${q(user.userId)}, 'admin')`);
    a = mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: "admin", role: "admin", twoFactorVerifiedAt: null });
    universityOne = await uni(tt, { name: "One University" });
    universityTwo = await uni(tt, { name: "Two University" });
    const add = (university: string, cents: number, on: string, extra: Record<string, unknown> = {}) => paymentRow(tt, university, { amount_usd_cents: cents, received_on: on, entered_by: a.userId, ...extra });
    await add(universityOne, 100000, "2026-09-05");
    await add(universityOne, 50000, "2026-09-28");
    await add(universityTwo, 25050, "2026-10-02");
    await add(universityTwo, 99999, "2026-10-03", { voided_at: "2026-10-04T10:00:00Z", voided_by: a.userId, void_reason: "typo" });
    await add(universityOne, 1, "2026-10-15");
  });
  afterAll(async () => {
    await tt.close();
  });

  const list = async (filter = {}) => {
    await tt.asRuntime();
    try {
      return await listPayments(tt.db, a, filter);
    } finally {
      await tt.asOwner();
    }
  };

  it("totals leave out voided payments and group by university and by month (newest month first)", async () => {
    const result = await list();
    expect(result.totals.grandTotalCents).toBe(100000 + 50000 + 25050 + 1);
    expect(result.totals.count).toBe(4);
    expect(result.totals.byUniversity.map((u) => [u.name, u.totalCents])).toEqual([
      ["One University", 150001],
      ["Two University", 25050],
    ]);
    expect(result.totals.byMonth.map((m) => [m.month, m.totalCents])).toEqual([
      ["2026-10", 25051],
      ["2026-09", 150000],
    ]);
  });

  it("lists every row newest first, with the voided one marked and its reason", async () => {
    const { rows: listed } = await list();
    expect(listed.map((r) => r.receivedOn)).toEqual(["2026-10-15", "2026-10-03", "2026-10-02", "2026-09-28", "2026-09-05"]);
    const voided = listed.find((r) => r.voidedAt);
    expect(voided).toMatchObject({ amountUsdCents: 99999, voidReason: "typo" });
  });

  it("filters by university, by date (inclusive) and by status; the totals follow the university and date but not the status", async () => {
    expect((await list({ universityId: universityTwo })).rows).toHaveLength(2);
    expect((await list({ from: "2026-09-28", to: "2026-10-02" })).rows.map((r) => r.receivedOn)).toEqual(["2026-10-02", "2026-09-28"]);
    expect((await list({ status: "voided" })).rows).toHaveLength(1);
    const active = await list({ status: "active" });
    expect(active.rows).toHaveLength(4);
    const voidedOnly = await list({ status: "voided" });
    expect(voidedOnly.totals.grandTotalCents).toBe(175051);
  });

  it("an empty ledger has zero totals and no rows", async () => {
    const result = await list({ universityId: randomUUID() });
    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ grandTotalCents: 0, count: 0, byUniversity: [], byMonth: [] });
  });

  it("caps the list at 200 rows but not the totals, and says it was cut", async () => {
    await tt.run(`
      insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by)
      select gen_random_uuid(), gen_random_uuid(), ${q(universityOne)}, 100, '2026-08-01'::date + (g % 20), 'bulk' from generate_series(1, 210) g`);
    const result = await list();
    expect(result.rows).toHaveLength(200);
    expect(result.truncated).toBe(true);
    expect(result.totals.count).toBe(4 + 210);
  });
});

describe("S9.2 the CSV export", () => {
  it("neutralises cells that start with = + - or @, and quotes commas, quotes and line breaks", async () => {
    await record(admin, { universityId: universityB, amount: "10", note: "=HYPERLINK(\"http://evil\")" });
    await record(admin, { amount: "11", note: "+1+1" });
    await record(admin, { amount: "12", note: "-2" });
    await record(admin, { amount: "13", note: "@SUM(A1)" });
    await record(admin, { amount: "14", note: "plain, with \"quotes\"" });
    const answer = await get("payments-csv", admin, "?status=active");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Type")).toContain("text/csv");
    expect(answer.headers.get("Content-Disposition")).toBe('attachment; filename="payments-2026-10-26.csv"');
    expect(answer.headers.get("Cache-Control")).toBe("no-store");
    expect(answer.text.startsWith("﻿")).toBe(true);
    expect(answer.text).toContain("'=HYPERLINK(");
    expect(answer.text).toContain(",'+1+1");
    expect(answer.text).toContain(",'-2");
    expect(answer.text).toContain(",'@SUM(A1)");
    expect(answer.text).toContain('"plain, with ""quotes"""');
    // The university name that starts with "=" is neutralised too.
    expect(answer.text).toMatch(/(^|,|\r\n)'=Beta University,/);
    // No cell of the file starts with a formula character once the quote is applied.
    for (const line of answer.text.replace(/^﻿/, "").split("\r\n").slice(1).filter(Boolean)) {
      expect(line.startsWith("=")).toBe(false);
    }
  });

  it("respects the filters and writes plain dollars", async () => {
    const answer = await get("payments-csv", admin, `?university=${universityA}&from=2026-10-26&to=2026-10-26`);
    const lines = answer.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Date received,University,Amount (USD),Linked lead,Entered by,Entered at (WAT),Status,Void reason,Note");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line.startsWith("2026-10-26,Alpha University,")).toBe(true);
      expect(line.split(",")[2]).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("marks a voided payment and carries the reason", async () => {
    const made = await record(admin, { amount: "77" });
    await post("payments.void", admin, { id: made.json.id, reason: "=bad" });
    const answer = await get("payments-csv", admin, "?status=voided");
    expect(answer.text).toContain(",Voided,'=bad,");
  });

  it("refuses a range it cannot export in one file", async () => {
    await t.run(`
      insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by)
      select gen_random_uuid(), gen_random_uuid(), ${q(universityA)}, 100, '2025-01-01', 'bulk' from generate_series(1, 5001)`);
    expect((await get("payments-csv", admin, "?from=2025-01-01&to=2025-01-01")).status).toBe(413);
    expect((await get("payments-csv", admin, "?from=2025-01-01&to=2025-01-01&university=" + universityB)).status).toBe(200);
  });
});

describe("S9.2 filters and the lead picker", () => {
  it("refuses a filter the screen could not have produced", async () => {
    for (const query of ["?status=bogus", "?from=2026-13-01", "?university=not-a-uuid", "?from=2026-10-20&to=2026-10-01", "?extra=1"]) {
      expect((await get("payments", admin, query)).status, query).toBe(400);
    }
  });

  it("returns the today the form should default to, in WAT", async () => {
    expect((await get("payments", admin)).json.today).toBe("2026-10-26");
  });

  it("finds a lead by reference or name and leaves out merged and erased leads", async () => {
    const found = await leadRow(t, { name: "Zanele Picker" });
    const ref = String((await rows(`select ref from lead where id = ${q(found)}`))[0]?.ref);
    const merged = await leadRow(t, { name: "Zanele Merged", merged_into_id: found });
    const erased = await leadRow(t, { name: null, whatsapp_e164: null, email: null, results: [], anonymised_at: "2026-10-01T00:00:00Z" });
    const byName = await asRuntime(() => searchLeadsForPayment(t.db, admin, "zanele"));
    expect(byName.map((l) => l.id)).toEqual([found]);
    expect(byName.map((l) => l.id)).not.toContain(merged);
    expect(byName.map((l) => l.id)).not.toContain(erased);
    expect((await asRuntime(() => searchLeadsForPayment(t.db, admin, ref.slice(3, 9)))).map((l) => l.id)).toContain(found);
    expect(await asRuntime(() => searchLeadsForPayment(t.db, student, "zanele"))).toEqual([]);
    expect((await get("payment-leads", admin, "?q=a")).status).toBe(400);
    expect((await get("payment-leads", admin, "?q=zanele")).json.leads).toHaveLength(1);
  });

  it("treats % and _ in a search as plain characters", async () => {
    expect(await asRuntime(() => searchLeadsForPayment(t.db, admin, "%%"))).toEqual([]);
    expect(await asRuntime(() => searchLeadsForPayment(t.db, admin, "__"))).toEqual([]);
  });
});

describe("S9.3 payments totals in analytics", () => {
  let ta: TestDb;
  let a: Actor;
  let one = "";
  let two = "";

  beforeAll(async () => {
    ta = await createTestDb();
    const user = await ta.signIn();
    await ta.run(`insert into app_user (id, role) values (${q(user.userId)}, 'admin')`);
    a = mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: "admin", role: "admin", twoFactorVerifiedAt: null });
    one = await uni(ta, { name: "One" });
    two = await uni(ta, { name: "Two" });
    await paymentRow(ta, one, { amount_usd_cents: 100000, received_on: "2026-10-10", entered_by: a.userId });
    await paymentRow(ta, two, { amount_usd_cents: 20000, received_on: "2026-10-12", entered_by: a.userId });
    await paymentRow(ta, two, { amount_usd_cents: 5000, received_on: "2026-09-01", entered_by: a.userId });
    await paymentRow(ta, one, { amount_usd_cents: 999999, received_on: "2026-10-11", entered_by: a.userId, voided_at: "2026-10-12T00:00:00Z", voided_by: a.userId, void_reason: "x" });
  });
  afterAll(async () => {
    await ta.close();
  });

  async function analytics(query: string): Promise<Record<string, any>> {
    const call = analyticsDataCalls({ db: ta.db, ownerEmail: "", totpKey: "", now: () => now })["admin/analytics"] as DataCall;
    await ta.asRuntime();
    try {
      const result = await call(a, { token: null, url: new URL(`https://example.test/api/v1/admin/analytics${query}`) });
      return JSON.parse(JSON.stringify(result)) as Record<string, any>;
    } finally {
      await ta.asOwner();
    }
  }

  it("adds up what was received in the range, voided payments left out", async () => {
    const json = await analytics("?from=2026-10-01&to=2026-10-26");
    expect(json.payments.totalCents).toBe(120000);
    expect(json.payments.count).toBe(2);
    expect(json.payments.byUniversity.map((r: any) => [r.name, r.totalCents])).toEqual([
      ["One", 100000],
      ["Two", 20000],
    ]);
  });

  it("follows the range and the university filter, and ignores the country filter", async () => {
    expect((await analytics("?from=2026-09-01&to=2026-09-30")).payments.totalCents).toBe(5000);
    expect((await analytics(`?from=2026-10-01&to=2026-10-26&university=${two}`)).payments.totalCents).toBe(20000);
    expect((await analytics("?from=2026-10-01&to=2026-10-26&country=NG")).payments.totalCents).toBe(120000);
  });

  it("is zero, not missing, when nothing was received", async () => {
    expect((await analytics("?from=2026-01-01&to=2026-01-31")).payments).toEqual({ totalCents: 0, count: 0, byUniversity: [] });
  });
});

describe("S9.4 all-admin performance", () => {
  let tp: TestDb;
  let boss: Actor;
  let busy: Actor;
  let idle: Actor;

  beforeAll(async () => {
    tp = await createTestDb();
    const make = async (role: "owner" | "admin") => {
      const user = await tp.signIn();
      await tp.run(`insert into app_user (id, role) values (${q(user.userId)}, ${q(role)})`);
      return mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: role, role, twoFactorVerifiedAt: null });
    };
    boss = await make("owner");
    busy = await make("admin");
    idle = await make("admin");
    // Two leads for the busy admin, one answered 30 minutes after it arrived; one overdue lead.
    await leadRow(tp, { assigned_admin_id: busy.userId, received_at: "2026-10-20T10:00:00Z", first_response_at: "2026-10-20T10:30:00Z", sla_due_at: "2026-10-20T14:00:00Z" });
    await leadRow(tp, { assigned_admin_id: busy.userId, received_at: "2026-10-21T10:00:00Z", sla_due_at: "2026-10-21T14:00:00Z" });
  });
  afterAll(async () => {
    await tp.close();
  });

  const call = async (who: Actor, query = "?from=2026-10-01&to=2026-10-26") => {
    const fn = analyticsDataCalls({ db: tp.db, ownerEmail: "", totpKey: "", now: () => now })["admin/performance-all"] as DataCall;
    await tp.asRuntime();
    try {
      const result = await fn(who, { token: null, url: new URL(`https://example.test/api/v1/admin/performance-all${query}`) });
      return result instanceof Response ? { status: result.status, json: (await result.json()) as Record<string, any> } : { status: 200, json: JSON.parse(JSON.stringify(result)) as Record<string, any> };
    } finally {
      await tp.asOwner();
    }
  };

  it("lets the owner see every admin, including one with no leads", async () => {
    const answer = await call(boss);
    expect(answer.status).toBe(200);
    const byId = new Map<string, any>(answer.json.admins.map((r: any) => [r.userId, r]));
    expect(byId.get(busy.userId)).toMatchObject({ assigned: 2, answered: 1, medianMinutes: 30, overdue: 1 });
    expect(byId.get(idle.userId)).toMatchObject({ assigned: 0, answered: 0, medianMinutes: null, overdue: 0 });
    expect(byId.has(boss.userId)).toBe(true);
  });

  it("refuses an admin: they can only read their own numbers", async () => {
    await expect(call(busy)).rejects.toBeInstanceOf(AuthError);
    await expect(call(idle)).rejects.toThrow(/Not allowed/);
  });

  it("refuses a range the screen could not have produced", async () => {
    expect((await call(boss, "?from=2026-10-26&to=2026-10-01")).status).toBe(400);
    expect((await call(boss, "?bogus=1")).status).toBe(400);
  });
});
