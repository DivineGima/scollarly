import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mintActor, type Actor } from "@/server/auth/actor";
import { listPayments } from "@/server/repositories/payments";
import { createTestDb, type TestDb } from "./helpers/db";
import { paymentRow, q, uni } from "./helpers/fixtures";

/**
 * S9.2 totals, list and filters. Its own file because it builds its own database: on the CI Postgres service container every
 * createTestDb() resets the one shared schema, so a second database inside stage9-payments.test.ts wiped the first one mid-file.
 */

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
