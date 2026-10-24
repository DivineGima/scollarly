import { randomUUID } from "node:crypto";
import { generateRef } from "@/lib/ref";
import { uuidv7 } from "@/lib/uuid";
import type { TestDb } from "./db";

/** SQL literal for a test value. Test code only: values are never user input. */
export function q(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const cast = typeof value === "object" ? "::jsonb" : "";
  return `'${text.replace(/'/g, "''")}'${cast}`;
}

/** Inserts one row as the owner role and returns its id. `overrides` replace or add columns; a null removes the default. */
export async function insertRow(t: TestDb, table: string, defaults: Record<string, unknown>, overrides: Record<string, unknown> = {}): Promise<string> {
  const row = { ...defaults, ...overrides };
  const columns = Object.keys(row);
  const id = String(row.id ?? "");
  await t.run(`insert into ${table} (${columns.join(", ")}) values (${columns.map((c) => q(row[c])).join(", ")})`);
  return id;
}

const NOW = () => new Date().toISOString();

export const uni = (t: TestDb, overrides: Record<string, unknown> = {}) =>
  insertRow(t, "university", { id: uuidv7(), slug: `uni-${randomUUID().slice(0, 8)}`, name: "Test University" }, overrides);

export const programmeRow = (t: TestDb, universityId: string, overrides: Record<string, unknown> = {}) =>
  insertRow(t, "programme", { id: uuidv7(), university_id: universityId, name: "Test Programme" }, overrides);

export const consent = (t: TestDb, overrides: Record<string, unknown> = {}) =>
  insertRow(t, "consent_record", { id: uuidv7(), subject_name: "Test Person", scope: "testimonial", granted_at: NOW() }, overrides);

export const leadRow = (t: TestDb, overrides: Record<string, unknown> = {}) => {
  const ref = generateRef();
  return insertRow(
    t,
    "lead",
    {
      id: uuidv7(),
      ref,
      client_ref: ref,
      idempotency_key: randomUUID(),
      payload_hash: "a".repeat(64),
      name: "Test Student",
      whatsapp_e164: "+237651232301",
      country_code: "CM",
      intake_kind: "full",
      qualification_type: "olevel_alevel",
      consent_notice_version: "v1",
      consent_at: NOW(),
      sla_due_at: NOW(),
      sla_hours_applied: 4,
    },
    overrides,
  );
};

export const appUserRow = (t: TestDb, id: string, role: "student" | "admin" | "owner" = "student") => insertRow(t, "app_user", { id, role });

export const paymentRow = (t: TestDb, universityId: string, overrides: Record<string, unknown> = {}) =>
  insertRow(
    t,
    "placement_payment",
    { id: uuidv7(), submission_token: randomUUID(), university_id: universityId, amount_usd_cents: 150000, received_on: "2026-10-01", entered_by: "someone" },
    overrides,
  );
