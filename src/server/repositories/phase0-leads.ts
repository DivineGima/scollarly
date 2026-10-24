import { count, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
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
 * One call (S0.3). `app_create_phase0_lead` inserts, or returns the row that already has this idempotency key (migration 0002).
 * A second request with the same key and the same payload hash is a replay, and the same key with a different
 * payload is a conflict (409). It is a database function so an anonymous visitor needs no right to read leads back.
 */
export async function insertStubLead(db: Db, row: StubLeadRow): Promise<StubLeadInsert> {
  const [result] = rowsOf<{ lead_id: string; stored_hash: string; created: boolean }>(
    await db.execute(
      sql`select * from public.app_create_phase0_lead(${row.id}::uuid, ${row.idempotencyKey}::uuid, ${row.payloadHash}, ${row.name}, ${row.whatsappE164}, ${row.countryCode})`,
    ),
  );
  if (!result) throw new Error("idempotency conflict without a stored row");
  if (result.created) return { kind: "created", id: result.lead_id };
  return result.stored_hash === row.payloadHash ? { kind: "replayed", id: result.lead_id } : { kind: "key_reused" };
}

/** Staff query: run it with `inContext` (the policy lets only staff read leads). */
export function countStubLeadsQuery(db: Db) {
  return db.select({ n: count() }).from(phase0LeadStub);
}
