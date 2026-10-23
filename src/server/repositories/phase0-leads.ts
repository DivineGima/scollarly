import { count, eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { phase0LeadStub } from "@/server/db/schema";

export interface StubLeadRow {
  id: string;
  idempotencyKey: string;
  payloadHash: string;
  name: string;
  whatsappE164: string;
  countryCode: string;
}

export type StubLeadInsert =
  | { kind: "created"; id: string }
  | { kind: "replayed"; id: string }
  | { kind: "key_reused" };

/**
 * One insert (S0.3). The unique idempotency key makes a retry safe: a second insert with the same key and
 * the same payload hash is a replay, and the same key with a different payload is a conflict (409).
 */
export async function insertStubLead(db: Db, row: StubLeadRow): Promise<StubLeadInsert> {
  const inserted = await db
    .insert(phase0LeadStub)
    .values(row)
    .onConflictDoNothing({ target: phase0LeadStub.idempotencyKey })
    .returning({ id: phase0LeadStub.id });
  const created = inserted[0];
  if (created) return { kind: "created", id: created.id };

  const [existing] = await db
    .select({ id: phase0LeadStub.id, payloadHash: phase0LeadStub.payloadHash })
    .from(phase0LeadStub)
    .where(eq(phase0LeadStub.idempotencyKey, row.idempotencyKey))
    .limit(1);
  if (!existing) throw new Error("idempotency conflict without a stored row");
  return existing.payloadHash === row.payloadHash ? { kind: "replayed", id: existing.id } : { kind: "key_reused" };
}

export async function countStubLeads(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(phase0LeadStub);
  return row?.n ?? 0;
}
