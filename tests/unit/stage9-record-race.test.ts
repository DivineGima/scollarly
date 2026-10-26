import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";

const runAs = vi.fn();
vi.mock("@/server/repositories/as-actor", () => ({ runAs: (...args: unknown[]) => runAs(...args) }));

import { recordPayment } from "@/server/repositories/payments";

/**
 * S9.1: the same submission token can arrive twice at once (a double tap or a retry). The statement that inserts also looks the row up,
 * but the other request's row is committed after that statement's snapshot, so the lookup is empty although `on conflict` fired. The
 * repository must then read again (a new statement, a new snapshot) and answer "replayed", not "token_reused".
 */
const db = { execute: () => ({}) } as unknown as Db;
const actor = { userId: "admin-1" } as unknown as Actor;
const payment = { id: "11111111-1111-7111-8111-111111111111", submissionToken: "22222222-2222-7222-8222-222222222222", universityId: "33333333-3333-7333-8333-333333333333", leadId: null, amountUsdCents: 150000, receivedOn: "2026-10-20", note: null };
const stored = { id: "44444444-4444-7444-8444-444444444444", university_id: payment.universityId, lead_id: null, amount_usd_cents: "150000", received_on: "2026-10-20", note: null };

describe("recordPayment with a same-token request in flight", () => {
  it("answers replayed when the first statement could not see the other request's row but a second read can", async () => {
    runAs.mockReset();
    runAs.mockResolvedValueOnce([[{ inserted: null, existing: null }]]).mockResolvedValueOnce([[{ existing: stored }]]);
    expect(await recordPayment(db, actor, payment)).toEqual({ kind: "replayed", id: stored.id });
    expect(runAs).toHaveBeenCalledTimes(2);
  });

  it("still answers token_reused when the row that won carries other facts", async () => {
    runAs.mockReset();
    runAs.mockResolvedValueOnce([[{ inserted: null, existing: null }]]).mockResolvedValueOnce([[{ existing: { ...stored, amount_usd_cents: "999" } }]]);
    expect(await recordPayment(db, actor, payment)).toEqual({ kind: "token_reused" });
  });

  it("answers token_reused when no row exists even on the second read", async () => {
    runAs.mockReset();
    runAs.mockResolvedValueOnce([[{ inserted: null, existing: null }]]).mockResolvedValueOnce([[{ existing: null }]]);
    expect(await recordPayment(db, actor, payment)).toEqual({ kind: "token_reused" });
  });

  it("does not read again when the first statement already created or found the row", async () => {
    runAs.mockReset();
    runAs.mockResolvedValueOnce([[{ inserted: payment.id, existing: null }]]);
    expect(await recordPayment(db, actor, payment)).toEqual({ kind: "created", id: payment.id });
    expect(runAs).toHaveBeenCalledTimes(1);
    runAs.mockReset();
    runAs.mockResolvedValueOnce([[{ inserted: null, existing: stored }]]);
    expect(await recordPayment(db, actor, payment)).toEqual({ kind: "replayed", id: stored.id });
    expect(runAs).toHaveBeenCalledTimes(1);
  });
});
