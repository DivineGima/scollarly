import { randomUUID } from "node:crypto";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as C from "@/lib/constants";
import { uuidv7 } from "@/lib/uuid";
import { schema } from "@/server/db/schema";
import { appUserRow, consent, insertRow, leadRow, paymentRow, programmeRow, q, uni } from "./helpers/fixtures";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const SCHEMA_TABLES = (Object.values(schema) as unknown[])
  .filter((table): table is PgTable => is(table, PgTable))
  .map((table) => getTableName(table))
  .sort();

describe("S1.1: every table of architecture 7 exists, with row level security and a policy (ADR-038)", () => {
  it("creates exactly the tables in the Drizzle schema, plus none by hand", async () => {
    const rows = (await t.run("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")) as { table_name: string }[];
    expect(rows.map((r) => r.table_name)).toEqual(SCHEMA_TABLES);
  });

  it("has every architecture 7.1 to 7.6 table", async () => {
    const expected = [
      "app_user", "owner_totp", "recovery_code", "step_up", "admin_invite", "audit_log",
      "pipeline_stage", "lead", "lead_programme_pref", "lead_activity", "lead_note", "lead_claim", "lead_duplicate_decision", "data_request",
      "university", "programme", "fee_structure", "campus_experience", "official_resource", "testimonial", "consent_record", "journey", "journey_step",
      "team_member", "faq", "trust_stat", "post", "process_step", "content_block", "message_template", "site_setting",
      "media_asset", "event", "event_daily_agg", "placement_payment",
    ];
    expect(SCHEMA_TABLES).toEqual(expect.arrayContaining(expected));
  });

  it("enables and FORCES row level security on every table, and gives each at least one policy", async () => {
    const rows = (await t.run(`
      select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`)) as { name: string; enabled: boolean; forced: boolean; policies: number }[];
    expect(rows.length).toBe(SCHEMA_TABLES.length);
    for (const row of rows) {
      expect(row.enabled, `${row.name}: RLS enabled`).toBe(true);
      expect(row.forced, `${row.name}: RLS forced`).toBe(true);
      expect(row.policies, `${row.name}: policies`).toBeGreaterThan(0);
    }
  });

  it("gives the runtime role no BYPASSRLS and no ownership of any table", async () => {
    const [role] = (await t.run("select rolbypassrls, rolsuper from pg_roles where rolname = 'app_runtime'")) as { rolbypassrls: boolean; rolsuper: boolean }[];
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
    const owned = (await t.run("select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = 'app_runtime'")) as { n: number }[];
    expect(owned[0]?.n).toBe(0);
  });

  it("grants the runtime role no DELETE on any table (no physical deletes in v1, ADR-014)", async () => {
    const rows = (await t.run(`select table_name from information_schema.role_table_grants where grantee = 'app_runtime' and privilege_type = 'DELETE' and table_schema = 'public'`)) as { table_name: string }[];
    expect(rows).toEqual([]);
  });
});

describe("S1.1: closed value lists in the database match src/lib/constants.ts", () => {
  const LISTS: [string, readonly string[]][] = [
    ["lead_intake_kind_check", C.INTAKE_KINDS],
    ["lead_qualification_type_check", C.QUALIFICATION_TYPES],
    ["lead_activity_type_check", C.LEAD_ACTIVITY_TYPES],
    ["lead_claim_method_check", C.CLAIM_METHODS],
    ["lead_claim_status_check", C.CLAIM_STATUSES],
    ["lead_claim_verification_check", C.VERIFICATION_METHODS],
    ["lead_duplicate_decision_check", C.DUPLICATE_DECISIONS],
    ["data_request_kind_check", C.DATA_REQUEST_KINDS],
    ["data_request_channel_check", C.DATA_REQUEST_CHANNELS],
    ["data_request_status_check", C.DATA_REQUEST_STATUSES],
    ["university_status_check", C.CONTENT_STATUSES],
    ["campus_experience_kind_check", C.CAMPUS_EXPERIENCE_KINDS],
    ["consent_record_scope_check", C.CONSENT_SCOPES],
    ["process_step_kind_check", C.PROCESS_STEP_KINDS],
    ["fee_structure_currency_check", C.CURRENCIES],
    ["event_type_check", C.EVENT_TYPES],
    ["media_asset_kind_check", C.MEDIA_KINDS],
    ["app_user_role_check", C.ROLES],
  ];

  it.each(LISTS)("%s lists exactly the constants", async (name, values) => {
    const [row] = (await t.run(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = '${name}'`)) as { def: string }[];
    expect(row, `${name} exists`).toBeDefined();
    const literals = [...(row?.def.matchAll(/'([A-Za-z0-9_]+)'/g) ?? [])].map((m) => m[1]);
    expect([...new Set(literals)].sort()).toEqual([...values].sort());
  });

  it("matches the YouTube id pattern used by the Zod schema", async () => {
    const [row] = (await t.run(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'campus_experience_youtube_id_format'`)) as { def: string }[];
    expect(row?.def).toContain(C.YOUTUBE_ID_PATTERN.source);
  });
});

describe("S1.1: seeds", () => {
  it("seeds the six pipeline stages in order, with an English name each", async () => {
    const rows = (await t.run("select code, position, name->>'en' as en from pipeline_stage order by position")) as { code: string; position: number; en: string }[];
    expect(rows.map((r) => r.code)).toEqual([...C.PIPELINE_STAGE_CODES]);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const row of rows) expect(row.en.length).toBeGreaterThan(0);
  });

  it("seeds exactly the default settings, with the SLA rule of FR-12 and no invented contact numbers", async () => {
    const rows = (await t.run("select key, value from site_setting")) as { key: string; value: unknown }[];
    const byKey = Object.fromEntries(rows.map((r) => [r.key, typeof r.value === "string" && r.value.startsWith("{") ? JSON.parse(r.value) : r.value]));
    expect(Object.keys(byKey).sort()).toEqual([...C.SETTING_KEYS].sort());
    expect(byKey.sla_weekday_hours).toBe(4);
    expect(byKey.sla_weekend_hours).toBe(24);
    expect(byKey.timezone).toBe("Africa/Douala");
    expect(byKey.stale_fee_days).toBe(180);
    expect(byKey.stale_tour_days).toBe(90);
    expect(byKey.collect_page_views).toBe(true);
    // Unconfirmed until the owner says so (tracker H3, H10).
    expect(byKey.whatsapp_number_e164).toBeNull();
    expect(byKey.contact_phone_display).toBeNull();
    expect(byKey.pipeline_freshness_days).toBeNull();
  });
});

describe("S1.1: fee CHECK (FR-2)", () => {
  const fee = async (overrides: Record<string, unknown>) => {
    const universityId = await uni(t);
    return insertRow(t, "fee_structure", { id: uuidv7(), university_id: universityId, currency: "USD", period: "per_year" }, overrides);
  };

  it("refuses a confirmed fee with no amounts, a zero minimum, or a maximum below the minimum", async () => {
    await expect(fee({ data_confirmed: true })).rejects.toThrow(/fee_structure_confirmed_range/);
    await expect(fee({ data_confirmed: true, amount_min: 0, amount_max: 100 })).rejects.toThrow(/fee_structure_confirmed_range/);
    await expect(fee({ data_confirmed: true, amount_min: 500, amount_max: 100 })).rejects.toThrow(/fee_structure_confirmed_range/);
    await expect(fee({ data_confirmed: true, amount_min: 500 })).rejects.toThrow(/fee_structure_confirmed_range/);
    await expect(fee({ data_confirmed: true, amount_max: 500 })).rejects.toThrow(/fee_structure_confirmed_range/);
  });

  it("accepts a confirmed fee with a real range, an equal minimum and maximum, and an unconfirmed fee with no amounts", async () => {
    await expect(fee({ data_confirmed: true, amount_min: 1500, amount_max: 2500 })).resolves.toBeTruthy();
    await expect(fee({ data_confirmed: true, amount_min: 1500, amount_max: 1500 })).resolves.toBeTruthy();
    await expect(fee({ data_confirmed: false })).resolves.toBeTruthy();
    await expect(fee({ data_confirmed: false, amount_min: 0, amount_max: 0 })).resolves.toBeTruthy();
  });

  it("refuses a currency other than USD or INR", async () => {
    await expect(fee({ currency: "EUR" })).rejects.toThrow(/fee_structure_currency_check/);
  });
});

describe("S1.1: publish gates (FR-13 and the unconfirmed-content guardrail)", () => {
  it("testimonial: published needs verified and a consent record", async () => {
    const base = { id: uuidv7(), student_name: "Test", quote: "Quote" };
    const consentId = await consent(t);
    await expect(insertRow(t, "testimonial", base, { id: uuidv7(), status: "published" })).rejects.toThrow(/testimonial_publish_gate/);
    await expect(insertRow(t, "testimonial", base, { id: uuidv7(), status: "published", verified: true })).rejects.toThrow(/testimonial_publish_gate/);
    await expect(insertRow(t, "testimonial", base, { id: uuidv7(), status: "published", consent_id: consentId })).rejects.toThrow(/testimonial_publish_gate/);
    await expect(insertRow(t, "testimonial", base, { id: uuidv7(), status: "published", verified: true, consent_id: consentId })).resolves.toBeTruthy();
    await expect(insertRow(t, "testimonial", base, { id: uuidv7(), status: "draft" })).resolves.toBeTruthy();
  });

  it("testimonial: an update that publishes without consent is refused too", async () => {
    const id = await insertRow(t, "testimonial", { id: uuidv7(), student_name: "Test", quote: "Quote" });
    await expect(t.run(`update testimonial set status = 'published' where id = ${q(id)}`)).rejects.toThrow(/testimonial_publish_gate/);
  });

  it("journey: published needs verified and a consent record", async () => {
    const base = { student_name: "Test", summary: "Summary" };
    const consentId = await consent(t, { scope: "journey" });
    await expect(insertRow(t, "journey", { id: uuidv7(), ...base }, { status: "published" })).rejects.toThrow(/journey_publish_gate/);
    await expect(insertRow(t, "journey", { id: uuidv7(), ...base }, { status: "published", verified: true })).rejects.toThrow(/journey_publish_gate/);
    await expect(insertRow(t, "journey", { id: uuidv7(), ...base }, { status: "published", verified: true, consent_id: consentId })).resolves.toBeTruthy();
  });

  it("team member and trust stat: published needs confirmed", async () => {
    await expect(insertRow(t, "team_member", { id: uuidv7(), name: "A", role_title: "B" }, { status: "published" })).rejects.toThrow(/team_member_publish_gate/);
    await expect(insertRow(t, "team_member", { id: uuidv7(), name: "A", role_title: "B" }, { status: "published", confirmed: true })).resolves.toBeTruthy();
    await expect(insertRow(t, "trust_stat", { id: uuidv7(), key: `k-${randomUUID()}`, label: "L", value: "V" }, { status: "published" })).rejects.toThrow(/trust_stat_publish_gate/);
    await expect(insertRow(t, "trust_stat", { id: uuidv7(), key: `k-${randomUUID()}`, label: "L", value: "V" }, { status: "published", confirmed: true })).resolves.toBeTruthy();
  });
});

describe("S1.1: YouTube id CHECK (FR-3)", () => {
  const tour = async (youtubeId: string | null) => {
    const universityId = await uni(t);
    return insertRow(t, "campus_experience", { id: uuidv7(), university_id: universityId, kind: "video", title: "Tour", youtube_id: youtubeId });
  };

  it("accepts exactly 11 characters from [a-zA-Z0-9_-] and null", async () => {
    await expect(tour("dQw4w9WgXcQ")).resolves.toBeTruthy();
    await expect(tour("a_b-C1d2E3f")).resolves.toBeTruthy();
    await expect(tour(null)).resolves.toBeTruthy();
  });

  it("refuses the wrong length, a space, a quote, a slash and an empty string", async () => {
    for (const bad of ["short", "dQw4w9WgXcQx", "dQw4w9WgXc ", "dQw4w9WgXc'", "dQw4w9Wg/cQ", ""]) {
      await expect(tour(bad), JSON.stringify(bad)).rejects.toThrow(/campus_experience_youtube_id_format/);
    }
  });
});

describe("S1.1: payments (ADR-012)", () => {
  it("requires a positive amount in cents", async () => {
    const universityId = await uni(t);
    await expect(paymentRow(t, universityId, { amount_usd_cents: 0 })).rejects.toThrow(/placement_payment_amount_positive/);
    await expect(paymentRow(t, universityId, { amount_usd_cents: -5 })).rejects.toThrow(/placement_payment_amount_positive/);
    await expect(paymentRow(t, universityId, { amount_usd_cents: 1 })).resolves.toBeTruthy();
  });

  it("void fields are all null or all set, and a void needs a non-blank reason", async () => {
    const universityId = await uni(t);
    const at = new Date().toISOString();
    await expect(paymentRow(t, universityId, { voided_at: at })).rejects.toThrow(/placement_payment_void_consistency/);
    await expect(paymentRow(t, universityId, { voided_at: at, voided_by: "admin-1" })).rejects.toThrow(/placement_payment_void_consistency/);
    await expect(paymentRow(t, universityId, { voided_by: "admin-1", void_reason: "typo" })).rejects.toThrow(/placement_payment_void_consistency/);
    await expect(paymentRow(t, universityId, { voided_at: at, voided_by: "admin-1", void_reason: "   " })).rejects.toThrow(/placement_payment_void_consistency/);
    await expect(paymentRow(t, universityId, { voided_at: at, voided_by: "admin-1", void_reason: "Entered twice" })).resolves.toBeTruthy();
    await expect(paymentRow(t, universityId)).resolves.toBeTruthy();
  });

  it("an update that voids without a reason is refused", async () => {
    const universityId = await uni(t);
    const id = await paymentRow(t, universityId);
    await expect(t.run(`update placement_payment set voided_at = now(), voided_by = 'a' where id = ${q(id)}`)).rejects.toThrow(/placement_payment_void_consistency/);
    await expect(t.run(`update placement_payment set voided_at = now(), voided_by = 'a', void_reason = 'wrong university' where id = ${q(id)}`)).resolves.toBeDefined();
  });

  it("submission_token is unique, so a replay records one payment", async () => {
    const universityId = await uni(t);
    const token = randomUUID();
    await paymentRow(t, universityId, { submission_token: token });
    await expect(paymentRow(t, universityId, { submission_token: token })).rejects.toThrow(/submission_token/);
    const rows = (await t.run(`select count(*)::int as n from placement_payment where submission_token = ${q(token)}`)) as { n: number }[];
    expect(rows[0]?.n).toBe(1);
  });

  it("requires a submission token", async () => {
    const universityId = await uni(t);
    await expect(paymentRow(t, universityId, { submission_token: null })).rejects.toThrow(/submission_token/);
  });
});

describe("S1.1: leads (architecture 7.2, ADR-030)", () => {
  it("accepts a full lead and a quick lead without a qualification", async () => {
    await expect(leadRow(t)).resolves.toBeTruthy();
    await expect(leadRow(t, { intake_kind: "quick", qualification_type: null })).resolves.toBeTruthy();
  });

  it("refuses a full lead without a qualification", async () => {
    await expect(leadRow(t, { qualification_type: null })).rejects.toThrow(/lead_qualification_required_for_full/);
  });

  it("refuses a quick lead that carries results, and an unknown qualification or intake kind", async () => {
    await expect(leadRow(t, { intake_kind: "quick", qualification_type: null, results: [{ subject: "Maths", grade: "A" }] })).rejects.toThrow(/lead_quick_has_no_results/);
    await expect(leadRow(t, { qualification_type: "degree" })).rejects.toThrow(/lead_qualification_type_check/);
    await expect(leadRow(t, { intake_kind: "other" })).rejects.toThrow(/lead_intake_kind_check/);
  });

  it("refuses a malformed reference, number, country, hash or SLA hours", async () => {
    await expect(leadRow(t, { ref: "SC-ABCDE-FGHIJ" })).rejects.toThrow(/lead_ref_format/); // I is not in the alphabet
    await expect(leadRow(t, { ref: "sc-abcde-fghjk" })).rejects.toThrow(/lead_ref_format/);
    await expect(leadRow(t, { client_ref: "nope" })).rejects.toThrow(/lead_client_ref_format/);
    await expect(leadRow(t, { whatsapp_e164: "651232301" })).rejects.toThrow(/lead_identity_or_anonymised/);
    await expect(leadRow(t, { whatsapp_e164: "+0651232301" })).rejects.toThrow(/lead_identity_or_anonymised/);
    await expect(leadRow(t, { whatsapp_e164: null })).rejects.toThrow(/lead_identity_or_anonymised/);
    await expect(leadRow(t, { name: "   " })).rejects.toThrow(/lead_identity_or_anonymised/);
    await expect(leadRow(t, { name: null })).rejects.toThrow(/lead_identity_or_anonymised/);
    await expect(leadRow(t, { country_code: "cm" })).rejects.toThrow(/lead_country_code_format/);
    await expect(leadRow(t, { payload_hash: "xyz" })).rejects.toThrow(/lead_payload_hash_format/);
    await expect(leadRow(t, { sla_hours_applied: 0 })).rejects.toThrow(/lead_sla_hours_positive/);
  });

  it("keeps the reference, the idempotency key and (separately) the client reference", async () => {
    const key = randomUUID();
    const first = await leadRow(t, { idempotency_key: key });
    await expect(leadRow(t, { idempotency_key: key })).rejects.toThrow(/idempotency_key/);
    const [row] = (await t.run(`select ref, client_ref from lead where id = ${q(first)}`)) as { ref: string; client_ref: string }[];
    await expect(leadRow(t, { ref: row?.ref })).rejects.toThrow(/lead_ref_unique|ref_unique|ref/);
    // A server-issued ref may differ from the device's client_ref after a collision (architecture 10.1).
    await expect(leadRow(t, { client_ref: row?.client_ref })).resolves.toBeTruthy();
  });

  it("starts at the share_results stage and refuses an unknown stage", async () => {
    const id = await leadRow(t);
    const [row] = (await t.run(`select stage_code from lead where id = ${q(id)}`)) as { stage_code: string }[];
    expect(row?.stage_code).toBe("share_results");
    await expect(leadRow(t, { stage_code: "nope" })).rejects.toThrow(/foreign key|stage_code/);
  });

  it("an anonymised lead has no name, number, email or results, and a live lead cannot be half-cleared", async () => {
    const id = await leadRow(t, { email: "a@example.test" });
    await expect(t.run(`update lead set name = null, whatsapp_e164 = null, email = null where id = ${q(id)}`)).rejects.toThrow(/lead_identity_or_anonymised/);
    await expect(t.run(`update lead set anonymised_at = now() where id = ${q(id)}`)).rejects.toThrow(/lead_identity_or_anonymised/);
    await t.run(`update lead set anonymised_at = now(), name = null, whatsapp_e164 = null, email = null, results = '[]'::jsonb where id = ${q(id)}`);
    const [row] = (await t.run(`select name, whatsapp_e164, email from lead where id = ${q(id)}`)) as Record<string, unknown>[];
    expect(row).toEqual({ name: null, whatsapp_e164: null, email: null });
  });

  it("a lead cannot be merged into itself", async () => {
    const id = await leadRow(t);
    await expect(t.run(`update lead set merged_into_id = id where id = ${q(id)}`)).rejects.toThrow(/lead_not_merged_into_itself/);
  });

  it("a programme preference has a unique rank per lead and a positive rank", async () => {
    const universityId = await uni(t);
    const [p1, p2] = [await programmeRow(t, universityId), await programmeRow(t, universityId)];
    const id = await leadRow(t);
    await t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(id)}, ${q(p1)}, 1)`);
    await expect(t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(id)}, ${q(p2)}, 1)`)).rejects.toThrow(/lead_programme_pref_rank/);
    await expect(t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(id)}, ${q(p1)}, 2)`)).rejects.toThrow();
    await expect(t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(id)}, ${q(p2)}, 0)`)).rejects.toThrow(/lead_programme_pref_rank_positive/);
  });

  it("a claim cannot be approved without a verification method (ADR-015)", async () => {
    await appUserRow(t, "claimant-1");
    const id = await leadRow(t);
    const claim = { id: uuidv7(), user_id: "claimant-1", lead_id: id, method: "ref" };
    await expect(insertRow(t, "lead_claim", claim, { status: "approved" })).rejects.toThrow(/lead_claim_approval_needs_method/);
    await expect(insertRow(t, "lead_claim", claim, { id: uuidv7(), status: "approved", verification_method: "guess" })).rejects.toThrow(/lead_claim_verification_check/);
    await expect(insertRow(t, "lead_claim", claim, { id: uuidv7(), status: "approved", verification_method: "email_match" })).resolves.toBeTruthy();
    await expect(insertRow(t, "lead_claim", claim, { id: uuidv7() })).resolves.toBeTruthy();
  });
});

describe("S1.1: other constraints", () => {
  it("event_daily_agg is unique per key even when country, university or page group is absent", async () => {
    const row = (country: string | null) => `insert into event_daily_agg (date, type, country, count) values ('2026-10-01', 'page_view', ${q(country)}, 1)`;
    await t.run(row(null));
    await expect(t.run(row(null))).rejects.toThrow(/event_daily_agg_key/);
    await t.run(row("CM"));
    await expect(t.run(row("CM"))).rejects.toThrow(/event_daily_agg_key/);
  });

  it("refuses an event type outside the five", async () => {
    await expect(insertRow(t, "event", { id: uuidv7(), type: "click" })).rejects.toThrow(/event_type_check/);
    await expect(insertRow(t, "event", { id: uuidv7(), type: "wa_tap" })).resolves.toBeTruthy();
  });

  it("refuses a bad slug and a translations value that is not an object", async () => {
    await expect(uni(t, { slug: "Not A Slug" })).rejects.toThrow(/university_slug_format/);
    await expect(uni(t, { slug: "-lead" })).rejects.toThrow(/university_slug_format/);
    await expect(uni(t, { translations: ["en"] })).rejects.toThrow(/university_translations_object/);
    await expect(uni(t, { slug: "jain-university", translations: { en: "Jain" } })).resolves.toBeTruthy();
  });

  it("refuses duplicate slugs, a bad content status and a non-positive programme duration", async () => {
    await uni(t, { slug: "dup-slug" });
    await expect(uni(t, { slug: "dup-slug" })).rejects.toThrow(/slug/);
    await expect(uni(t, { status: "live" })).rejects.toThrow(/university_status_check/);
    const universityId = await uni(t);
    await expect(programmeRow(t, universityId, { duration_months: 0 })).rejects.toThrow(/programme_duration_positive/);
  });

  it("refuses an admin invite that expires before it is created", async () => {
    await expect(
      insertRow(t, "admin_invite", { id: uuidv7(), email: "a@example.test", token_hash: `h-${randomUUID()}`, invited_by: "owner", created_at: "2026-10-02T00:00:00Z", expires_at: "2026-10-01T00:00:00Z" }),
    ).rejects.toThrow(/admin_invite_expiry_check/);
  });

  it("keeps the single-owner index from the first slice", async () => {
    await appUserRow(t, "the-owner", "owner");
    await expect(appUserRow(t, "second-owner", "owner")).rejects.toThrow(/app_user_single_owner/);
  });
});

describe("S1.1: append-only tables have no update or delete right, even for the runtime role (ADR-007, 7.1)", () => {
  it("lead_activity and audit_log accept inserts and refuse update and delete", async () => {
    await appUserRow(t, "staff-1", "admin");
    const leadId = await leadRow(t);
    await t.asRuntime();
    try {
      const ctx = `select set_config('app.user_id', 'staff-1', false), set_config('app.role', 'admin', false)`;
      await t.run(ctx);
      const activity = uuidv7();
      await t.run(`insert into lead_activity (id, lead_id, type, actor_id) values (${q(activity)}, ${q(leadId)}, 'created', 'staff-1')`);
      await expect(t.run(`update lead_activity set type = 'note' where id = ${q(activity)}`)).rejects.toThrow(/permission denied/);
      await expect(t.run(`delete from lead_activity where id = ${q(activity)}`)).rejects.toThrow(/permission denied/);

      const audit = uuidv7();
      await t.run(`insert into audit_log (id, actor_id, action, entity_type) values (${q(audit)}, 'staff-1', 'test', 'lead')`);
      await expect(t.run(`update audit_log set action = 'x' where id = ${q(audit)}`)).rejects.toThrow(/permission denied/);
      await expect(t.run(`delete from audit_log where id = ${q(audit)}`)).rejects.toThrow(/permission denied/);
    } finally {
      await t.run(`select set_config('app.user_id', '', false), set_config('app.role', '', false)`);
      await t.asOwner();
    }
  });
});
