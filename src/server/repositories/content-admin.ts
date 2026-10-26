import { type Name, sql, type SQL } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { columnOf, type ContentTypeKey, type FieldDef, type JourneyStepInput, type TypeDef, TYPE_DEFS } from "@/modules/content-admin/definitions";
import type { ContentValues, GateIssues } from "@/modules/content-admin/schema";
import { runAs } from "./as-actor";

/**
 * Content management reads and writes (architecture 7.3, 10.4, 16 B6; S6.1, S6.2, S6.5). One generic repository serves every
 * content type, driven by `TYPE_DEFS`: the table, columns and order come from that static list (never from a request), and every
 * value is a bound parameter. Each write is ONE statement, so the change, its audit row and (for a journey) its steps commit
 * together or not at all, and it carries the row's `updated_at` as a microsecond version (optimistic concurrency, ADR-017): a
 * change whose version no longer matches does nothing and reports `conflict`.
 *
 * Row level security stays under it (migration 0003): only staff can read a draft or write anything. Nothing here is a physical
 * delete: an item is archived, never removed (ADR-029).
 */

const VERSION_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;
const versionExpr = (alias: string) => sql.raw(`to_char(${alias}.updated_at at time zone 'UTC', '${VERSION_FORMAT}')`);
/** A version strictly newer than the old one, even inside one transaction. */
const bump = sql.raw("greatest(clock_timestamp(), t.updated_at + interval '1 microsecond')");

const table = (def: TypeDef) => sql.identifier(def.table);
const col = (name: string) => sql.identifier(name);

/** A value as a typed parameter. The cast follows the field's kind, so a null needs no guessing by the driver. */
function param(field: FieldDef, value: unknown): SQL {
  const v = value === undefined ? null : value;
  switch (field.kind) {
    case "number":
      return sql`${v}::integer`;
    case "money":
      return sql`${v === null ? null : String(v)}::numeric`;
    case "boolean":
      return sql`${v === true}::boolean`;
    case "date":
      return sql`${v}::date`;
    case "media":
      return sql`${v}::uuid`;
    case "ref":
      return field.ref === "stage" ? sql`${v}::text` : sql`${v}::uuid`;
    default:
      return sql`${v}::text`;
  }
}

/** The fields stored in their own column (every field except the translated-text ones). */
const columnFields = (def: TypeDef, forUpdate: boolean) => def.fields.filter((f) => !f.store && !(forUpdate && f.immutable));
const textField = (def: TypeDef) => def.fields.find((f) => f.store === "translations.en");

// ----------------------------------------------------------------------------------------------------------------
// What the list shows for each item, and which public page it belongs to
// ----------------------------------------------------------------------------------------------------------------

/** The text a list row shows. `t` is the table, `u` the university when the type has one. */
const LABEL: Record<ContentTypeKey, string> = {
  universities: "t.name",
  programmes: "t.name || ' · ' || coalesce((select u.name from university u where u.id = t.university_id), '')",
  fees:
    "coalesce((select u.name from university u where u.id = t.university_id), '') || ' · ' || t.currency || ' ' || coalesce(t.amount_min::text, '?') || ' to ' || coalesce(t.amount_max::text, '?') || ' · ' || t.period",
  campus: "t.title || ' (' || t.kind || ')'",
  resources: "t.title",
  testimonials: "t.student_name",
  journeys: "t.student_name",
  team: "t.name || ' · ' || t.role_title",
  faqs: "t.question",
  stats: "t.label || ': ' || t.value",
  steps: "t.kind || ' ' || t.position || '. ' || t.title",
  copy: "t.key",
  blog: "t.title",
  templates: "t.stage_code || ' / ' || t.locale || ' · ' || left(t.body, 60)",
};

/** The slug of the public page this item appears on, or null (a type with no page of its own). */
function slugExpr(def: TypeDef): SQL {
  if (def.publicPath) return sql.raw("t.slug");
  if (def.fields.some((f) => f.key === "universityId")) return sql.raw("(select u.slug from university u where u.id = t.university_id)");
  return sql.raw("null::text");
}

/** What the list marks beside an item: a reason to look at it. */
function flagExpr(def: TypeDef): SQL {
  if (def.stale === "fee") {
    return sql.raw(`case when t.status = 'published' and t.data_confirmed and t.last_updated_at < now() - make_interval(days => ${staleDays("stale_fee_days", 180)}) then 'stale' end`);
  }
  if (def.stale === "link") {
    return sql.raw(`case when t.status = 'published' and (t.url_last_checked_at is null or t.url_last_checked_at < now() - make_interval(days => ${staleDays("stale_tour_days", 90)})) then 'stale' end`);
  }
  if (def.consent) {
    return sql.raw("case when t.status <> 'published' and t.status <> 'archived' and (not t.verified or t.consent_id is null) then 'needs_consent' end");
  }
  return sql.raw("null::text");
}

/** The stale limit in days from `site_setting` (a JSON number), or the default when it is unset or not a whole number. */
function staleDays(key: "stale_fee_days" | "stale_tour_days", fallback: number): string {
  return `coalesce((select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric::int end from site_setting s where s.key = '${key}'), ${fallback})`;
}

// ----------------------------------------------------------------------------------------------------------------
// Lists and one item
// ----------------------------------------------------------------------------------------------------------------

export interface ListItem {
  id: string;
  label: string;
  status: "draft" | "published" | "archived";
  version: string;
  publishedAt: string | null;
  flag: "stale" | "needs_consent" | null;
}

export const LIST_LIMIT = 300;

export async function listContent(db: Db, actor: Actor, def: TypeDef, filter: { status?: ListItem["status"]; q?: string }): Promise<{ items: ListItem[]; truncated: boolean }> {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(sql`t.status = ${filter.status}`);
  if (filter.q) conditions.push(sql`(${sql.raw(LABEL[def.type])}) ilike ${`%${filter.q.replace(/[\\%_]/g, "\\$&")}%`}`);
  const where = conditions.length ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select t.id, ${sql.raw(LABEL[def.type])} as label, t.status, ${versionExpr("t")} as version,
             t.published_at, ${flagExpr(def)} as flag
        from ${table(def)} t ${where}
       order by ${sql.raw(def.order)}
       limit ${LIST_LIMIT + 1}`),
  );
  const rows = rowsOf<{ id: string; label: string; status: ListItem["status"]; version: string; published_at: string | Date | null; flag: ListItem["flag"] }>(result);
  return {
    items: rows.slice(0, LIST_LIMIT).map((r) => ({
      id: r.id,
      label: r.label ?? "",
      status: r.status,
      version: r.version,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
      flag: r.flag,
    })),
    truncated: rows.length > LIST_LIMIT,
  };
}

export interface ItemRow {
  id: string;
  status: ListItem["status"];
  version: string;
  values: ContentValues;
  steps: JourneyStepInput[];
  /** The consent record attached to this item has been revoked. */
  consentRevoked: boolean;
  slug: string | null;
}

function valuesFromRow(def: TypeDef, row: Record<string, unknown>): ContentValues {
  const values: ContentValues = {};
  for (const field of def.fields) {
    if (field.store === "translations.en") {
      const t = row.translations;
      const en = t && typeof t === "object" ? (t as Record<string, unknown>).en : null;
      values[field.key] = typeof en === "string" ? en : null;
    } else {
      values[field.key] = row[columnOf(field)] ?? null;
    }
  }
  return values;
}

export async function getContent(db: Db, actor: Actor, def: TypeDef, id: string): Promise<ItemRow | null> {
  const consentJoin = def.consent ? sql`left join consent_record c on c.id = t.consent_id` : sql``;
  const consentCol = def.consent ? sql`(c.revoked_at is not null)` : sql`false`;
  const main = db.execute(sql`
    select to_jsonb(t) as row, t.status, ${versionExpr("t")} as version, ${consentCol} as consent_revoked, ${slugExpr(def)} as slug
      from ${table(def)} t ${consentJoin} where t.id = ${id}::uuid`);
  let first: unknown;
  let second: unknown;
  if (def.steps) {
    [first, second] = await runAs(db, actor, main, db.execute(sql`select position, title, body, date_label from journey_step where journey_id = ${id}::uuid order by position`));
  } else {
    [first] = await runAs(db, actor, main);
  }
  const r = rowsOf<{ row: Record<string, unknown>; status: ListItem["status"]; version: string; consent_revoked: boolean; slug: string | null }>(first)[0];
  if (!r) return null;
  return {
    id,
    status: r.status,
    version: r.version,
    values: valuesFromRow(def, r.row),
    steps: def.steps ? rowsOf<{ title: string; body: string; date_label: string | null }>(second).map((st) => ({ title: st.title, body: st.body, dateLabel: st.date_label })) : [],
    consentRevoked: r.consent_revoked === true,
    slug: r.slug,
  };
}

// ----------------------------------------------------------------------------------------------------------------
// Writes
// ----------------------------------------------------------------------------------------------------------------

export type WriteOutcome =
  | { kind: "ok"; id: string; version: string; status: ListItem["status"]; slug: string | null }
  | { kind: "conflict"; version: string }
  | { kind: "archived"; version: string }
  | { kind: "not_found" }
  | { kind: "duplicate"; field: string }
  | { kind: "gate"; issues: GateIssues };

/** Postgres error code and constraint, whichever way the driver wraps them. */
function dbError(error: unknown): { code?: string; constraint?: string } | null {
  const own = error as { code?: unknown; constraint?: unknown; cause?: unknown } | null;
  const nested = own?.cause as { code?: unknown; constraint?: unknown } | undefined;
  const code = typeof own?.code === "string" ? own.code : typeof nested?.code === "string" ? nested.code : undefined;
  const constraint = typeof own?.constraint === "string" ? own.constraint : typeof nested?.constraint === "string" ? nested.constraint : undefined;
  if (!code) return null;
  return { code, ...(constraint ? { constraint } : {}) };
}

/** A database refusal that is a normal answer to the person (a clash, a gate), as an outcome. Anything else is rethrown. */
function outcomeOfDbError(def: TypeDef, error: unknown): WriteOutcome {
  const info = dbError(error);
  if (info?.code === "23505") {
    const unique = def.fields.find((f) => f.immutable && info.constraint?.includes(`_${columnOf(f)}_`)) ?? def.fields.find((f) => f.immutable);
    return { kind: "duplicate", field: unique?.key ?? "form" };
  }
  if (info?.code === "23514") {
    const c = info.constraint ?? "";
    if (c.includes("confirmed_range")) return { kind: "gate", issues: { amountMin: "FEE_RANGE", amountMax: "FEE_RANGE" } };
    if (c.includes("consent_in_force")) return { kind: "gate", issues: { consentId: "CONSENT_REVOKED" } };
    if (c.includes("publish_gate")) {
      const confirmed = def.fields.find((f) => f.key === "confirmed");
      return { kind: "gate", issues: confirmed ? { confirmed: "NEEDS_CONFIRMED" } : { verified: "NEEDS_VERIFIED", consentId: "NEEDS_CONSENT" } };
    }
    return { kind: "gate", issues: { form: "INVALID" } };
  }
  if (info?.code === "23503") return { kind: "gate", issues: { form: "REFERENCE_NOT_FOUND" } };
  throw error;
}

function auditCte(actor: Actor, action: string, def: TypeDef, source: string, meta: SQL) {
  return sql`aud as (
    insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
    select gen_random_uuid(), ${actor.userId}, ${action}, ${def.table}, ${sql.raw(source)}.id::text, ${meta} from ${sql.raw(source)}
  )`;
}

/** The statement that writes a journey's steps, positions 1, 2, 3 in the order given. Steps are added and edited, never removed. */
function stepsCte(steps: readonly JourneyStepInput[], source: string) {
  const rows = steps.map((s, i) => ({ pos: i + 1, title: s.title, body: s.body, date_label: s.dateLabel }));
  return sql`steps as (
    insert into journey_step (id, journey_id, position, title, body, date_label)
    select gen_random_uuid(), ${sql.raw(source)}.id, s.pos, s.title, s.body, s.date_label
      from ${sql.raw(source)}, jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as s(pos int, title text, body text, date_label text)
    on conflict on constraint journey_step_position do update set title = excluded.title, body = excluded.body, date_label = excluded.date_label
    returning 1
  )`;
}

export interface SaveInput {
  /** Null creates the item. */
  id: string | null;
  /** Required with an `id`. */
  version: string | null;
  newId: string;
  values: ContentValues;
  steps?: readonly JourneyStepInput[];
}

/** The fields whose value changed, by name. Names only: a value can be a person's name (architecture 7.1: no personal data in the audit). */
export function changedFields(def: TypeDef, before: ContentValues, after: ContentValues): string[] {
  return def.fields.filter((f) => !f.immutable && JSON.stringify(before[f.key] ?? null) !== JSON.stringify(after[f.key] ?? null)).map((f) => f.key);
}

export async function createContent(db: Db, actor: Actor, def: TypeDef, input: SaveInput): Promise<WriteOutcome> {
  const fields = columnFields(def, false);
  const text = textField(def);
  const english = text ? ((input.values[text.key] as string | null) ?? null) : null;
  const columns = [col("id"), ...fields.map((f) => col(columnOf(f))), ...(text ? [col("translations")] : []), col("status"), col("created_by"), col("updated_by")];
  const values = [
    sql`${input.newId}::uuid`,
    ...fields.map((f) => param(f, input.values[f.key])),
    ...(text ? [sql`case when ${english}::text is null then '{}'::jsonb else jsonb_build_object('en', ${english}::text) end`] : []),
    sql`'draft'`,
    sql`${actor.userId}`,
    sql`${actor.userId}`,
  ];
  return runInsert(db, actor, def, input, columns, values);
}

async function runInsert(db: Db, actor: Actor, def: TypeDef, input: SaveInput, columns: Name[], values: SQL[]): Promise<WriteOutcome> {
  const withSteps = def.steps && input.steps && input.steps.length > 0;
  try {
    const [result] = await runAs(
      db,
      actor,
      db.execute(sql`
        with ins as (
          insert into ${table(def)} as t (${sql.join(columns, sql`, `)}) values (${sql.join(values, sql`, `)})
          returning t.id, t.status, t.updated_at, ${slugExpr(def)} as slug
        ), ${withSteps ? sql`${stepsCte(input.steps ?? [], "ins")}, ` : sql``}
        ${auditCte(actor, "content.save", def, "ins", sql`jsonb_build_object('type', ${def.type}::text, 'created', true)`)}
        select ins.id, ins.status, ${versionExpr("ins")} as version, ins.slug from ins`),
    );
    const row = rowsOf<{ id: string; status: ListItem["status"]; version: string; slug: string | null }>(result)[0];
    if (!row) throw new Error("The insert returned no row");
    return { kind: "ok", id: row.id, version: row.version, status: row.status, slug: row.slug };
  } catch (error) {
    return outcomeOfDbError(def, error);
  }
}

export async function updateContent(db: Db, actor: Actor, def: TypeDef, input: SaveInput & { id: string; version: string }, changed: readonly string[]): Promise<WriteOutcome> {
  const fields = columnFields(def, true);
  const text = textField(def);
  const sets: SQL[] = [
    ...fields.map((f) => sql`${col(columnOf(f))} = ${param(f, input.values[f.key])}`),
    ...(text
      ? [
          sql`translations = case when ${(input.values[text.key] as string | null) ?? null}::text is null then t.translations - 'en' else t.translations || jsonb_build_object('en', ${(input.values[text.key] as string | null) ?? null}::text) end`,
        ]
      : []),
    sql`updated_by = ${actor.userId}`,
    sql`updated_at = ${bump}`,
    ...(def.type === "fees" ? [sql`last_updated_at = now()`] : []),
  ];
  const withSteps = def.steps && input.steps && input.steps.length > 0;
  try {
    const [result] = await runAs(
      db,
      actor,
      db.execute(sql`
        with upd as (
          update ${table(def)} t set ${sql.join(sets, sql`, `)}
           where t.id = ${input.id}::uuid and t.updated_at = ${input.version}::timestamptz and t.status <> 'archived'
          returning t.id, t.status, t.updated_at, ${slugExpr(def)} as slug
        ), ${withSteps ? sql`${stepsCte(input.steps ?? [], "upd")}, ` : sql``}
        ${auditCte(actor, "content.save", def, "upd", sql`jsonb_build_object('type', ${def.type}::text, 'fields', ${JSON.stringify(changed)}::jsonb)`)}
        select upd.id, upd.status, ${versionExpr("upd")} as version, upd.slug from upd`),
    );
    const row = rowsOf<{ id: string; status: ListItem["status"]; version: string; slug: string | null }>(result)[0];
    if (row) return { kind: "ok", id: row.id, version: row.version, status: row.status, slug: row.slug };
    return await explainMiss(db, actor, def, input.id);
  } catch (error) {
    return outcomeOfDbError(def, error);
  }
}

/** Why a change that matched no row did nothing, read after the fact (the quick path never pays for this). */
async function explainMiss(db: Db, actor: Actor, def: TypeDef, id: string): Promise<WriteOutcome> {
  const [result] = await runAs(db, actor, db.execute(sql`select t.status, ${versionExpr("t")} as version from ${table(def)} t where t.id = ${id}::uuid`));
  const row = rowsOf<{ status: string; version: string }>(result)[0];
  if (!row) return { kind: "not_found" };
  if (row.status === "archived") return { kind: "archived", version: row.version };
  return { kind: "conflict", version: row.version };
}

export type StatusAction = "publish" | "unpublish" | "archive" | "restore";

const TRANSITION: Record<StatusAction, { from: readonly string[]; to: string; audit: string }> = {
  publish: { from: ["draft"], to: "published", audit: "content.publish" },
  unpublish: { from: ["published"], to: "draft", audit: "content.unpublish" },
  archive: { from: ["draft", "published"], to: "archived", audit: "content.archive" },
  restore: { from: ["archived"], to: "draft", audit: "content.restore" },
};

/** Moves an item between statuses when its version still matches. The caller has already run the publish gates. */
export async function changeStatus(db: Db, actor: Actor, def: TypeDef, input: { id: string; version: string }, action: StatusAction): Promise<WriteOutcome> {
  const move = TRANSITION[action];
  try {
    const [result] = await runAs(
      db,
      actor,
      db.execute(sql`
        with upd as (
          update ${table(def)} t
             set status = ${move.to},
                 published_at = case when ${move.to} = 'published' then coalesce(t.published_at, now()) else t.published_at end,
                 updated_by = ${actor.userId}, updated_at = ${bump}
           where t.id = ${input.id}::uuid and t.updated_at = ${input.version}::timestamptz and t.status = any(${pgTextArray(move.from)}::text[])
          returning t.id, t.status, t.updated_at, ${slugExpr(def)} as slug
        ), ${auditCte(actor, move.audit, def, "upd", sql`jsonb_build_object('type', ${def.type}::text, 'to', ${move.to}::text)`)}
        select upd.id, upd.status, ${versionExpr("upd")} as version, upd.slug from upd`),
    );
    const row = rowsOf<{ id: string; status: ListItem["status"]; version: string; slug: string | null }>(result)[0];
    if (row) return { kind: "ok", id: row.id, version: row.version, status: row.status, slug: row.slug };
    const miss = await explainMiss(db, actor, def, input.id);
    // The wrong starting status (already published, already archived) or a stale version: either way the screen reloads.
    return miss.kind === "archived" ? { kind: "conflict", version: miss.version } : miss;
  } catch (error) {
    return outcomeOfDbError(def, error);
  }
}

function pgTextArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/[\\"]/g, "\\$&")}"`).join(",")}}`;
}

/** S6.5 "Mark checked": a fee is confirmed still right (`last_updated_at`), a link is confirmed still working (`url_last_checked_at`). */
export async function markChecked(db: Db, actor: Actor, def: TypeDef, input: { id: string; version: string }): Promise<WriteOutcome> {
  const column = def.stale === "fee" ? "last_updated_at" : "url_last_checked_at";
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with upd as (
        update ${table(def)} t set ${sql.identifier(column)} = now(), updated_by = ${actor.userId}, updated_at = ${bump}
         where t.id = ${input.id}::uuid and t.updated_at = ${input.version}::timestamptz and t.status <> 'archived'
        returning t.id, t.status, t.updated_at, ${slugExpr(def)} as slug
      ), ${auditCte(actor, "content.markChecked", def, "upd", sql`jsonb_build_object('type', ${def.type}::text)`)}
      select upd.id, upd.status, ${versionExpr("upd")} as version, upd.slug from upd`),
  );
  const row = rowsOf<{ id: string; status: ListItem["status"]; version: string; slug: string | null }>(result)[0];
  if (row) return { kind: "ok", id: row.id, version: row.version, status: row.status, slug: row.slug };
  return explainMiss(db, actor, def, input.id);
}

// ----------------------------------------------------------------------------------------------------------------
// Consent records (FR-13)
// ----------------------------------------------------------------------------------------------------------------

export interface ConsentOption {
  id: string;
  subjectName: string;
  scope: string;
  grantedOn: string;
  revoked: boolean;
}

export async function createConsent(db: Db, actor: Actor, input: { id: string; subjectName: string; scope: string; evidenceNote: string | null; grantedOn: string }): Promise<void> {
  await runAs(
    db,
    actor,
    db.execute(sql`
      with ins as (
        insert into consent_record (id, subject_name, scope, evidence_note, granted_at, recorded_by)
        values (${input.id}::uuid, ${input.subjectName}, ${input.scope}, ${input.evidenceNote}, ${input.grantedOn}::date, ${actor.userId})
        returning id
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'content.save', 'consent_record', ins.id::text, jsonb_build_object('scope', ${input.scope}::text, 'created', true) from ins
      )
      select 1`),
  );
}

export type RevokeConsentOutcome = { kind: "ok"; unpublished: number } | { kind: "not_found" } | { kind: "already_revoked" };

/** Revoking withdraws the consent and, in the same statement, takes every testimonial and journey that relied on it back to draft (FR-13). */
export async function revokeConsent(db: Db, actor: Actor, id: string): Promise<RevokeConsentOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with rev as (
        update consent_record set revoked_at = now() where id = ${id}::uuid and revoked_at is null returning id
      ), t as (
        update testimonial t set status = 'draft', updated_by = ${actor.userId}, updated_at = ${bump}
         where t.consent_id in (select id from rev) and t.status = 'published' returning 1
      ), j as (
        update journey t set status = 'draft', updated_by = ${actor.userId}, updated_at = ${bump}
         where t.consent_id in (select id from rev) and t.status = 'published' returning 1
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'content.unpublish', 'consent_record', rev.id::text,
               jsonb_build_object('revoked', true, 'unpublished', (select count(*) from t) + (select count(*) from j))
          from rev
      )
      select (select count(*) from rev)::int as revoked, ((select count(*) from t) + (select count(*) from j))::int as unpublished,
             exists (select 1 from consent_record where id = ${id}::uuid) as found`),
  );
  const row = rowsOf<{ revoked: number; unpublished: number; found: boolean }>(result)[0];
  if (row && row.revoked > 0) return { kind: "ok", unpublished: row.unpublished };
  return row?.found ? { kind: "already_revoked" } : { kind: "not_found" };
}

// ----------------------------------------------------------------------------------------------------------------
// Form options, the hub and the stale report
// ----------------------------------------------------------------------------------------------------------------

export interface FormOptions {
  universities: { id: string; name: string }[];
  programmes: { id: string; name: string; universityId: string }[];
  consents: ConsentOption[];
  stages: { code: string; name: string }[];
  /** The live images a picture field can choose from (a few hundred at most: the storage budget caps the count). */
  media: { id: string; sha256: string; kind: string; width: number; height: number; alt: string }[];
}

/** What the reference fields of a form can choose from. Only the lists this type uses are read. */
export async function getFormOptions(db: Db, actor: Actor, def: TypeDef): Promise<FormOptions> {
  const refs = new Set(def.fields.flatMap((f) => (f.ref ? [f.ref] : [])));
  const empty = sql`select 1 where false`;
  const wantsMedia = def.fields.some((f) => f.kind === "media");
  const [universities, programmes, consents, stages, media] = await runAs(
    db,
    actor,
    db.execute(refs.has("university") ? sql`select id, name from university where status <> 'archived' order by name` : empty),
    db.execute(refs.has("programme") ? sql`select id, name, university_id from programme where status <> 'archived' order by name` : empty),
    db.execute(
      refs.has("consent")
        ? sql`select id, subject_name, scope, to_char(granted_at at time zone 'UTC', 'YYYY-MM-DD') as granted_on, (revoked_at is not null) as revoked from consent_record order by granted_at desc`
        : empty,
    ),
    db.execute(refs.has("stage") ? sql`select code, name from pipeline_stage order by position` : empty),
    db.execute(wantsMedia ? sql`select id, sha256, kind, width, height, alt from media_asset where archived_at is null order by created_at desc limit 400` : empty),
  );
  return {
    universities: rowsOf<{ id: string; name: string }>(universities),
    programmes: rowsOf<{ id: string; name: string; university_id: string }>(programmes).map((p) => ({ id: p.id, name: p.name, universityId: p.university_id })),
    consents: rowsOf<{ id: string; subject_name: string; scope: string; granted_on: string; revoked: boolean }>(consents).map((c) => ({
      id: c.id,
      subjectName: c.subject_name,
      scope: c.scope,
      grantedOn: c.granted_on,
      revoked: c.revoked,
    })),
    stages: rowsOf<{ code: string; name: Record<string, string> | string }>(stages).map((s) => ({ code: s.code, name: typeof s.name === "string" ? s.name : (s.name.en ?? s.code) })),
    media: rowsOf<{ id: string; sha256: string; kind: string; width: number; height: number; alt: Record<string, string> | null }>(media).map((m) => ({ id: m.id, sha256: m.sha256, kind: m.kind, width: m.width, height: m.height, alt: m.alt?.en ?? "" })),
  };
}

export interface HubCount {
  type: ContentTypeKey;
  draft: number;
  published: number;
  archived: number;
  /** Items that need a look: stale fees and links, testimonials and journeys waiting for consent. */
  warnings: number;
}

/** One statement for every card of the hub (S6.1): counts by status, and the warnings, from all 14 tables at once. */
export async function hubCounts(db: Db, actor: Actor): Promise<HubCount[]> {
  const defs = Object.values(TYPE_DEFS);
  const pieces = defs.map(
    (def) => sql`select ${def.type}::text as type, t.status, count(*)::int as n, count(${flagExpr(def)})::int as warn from ${table(def)} t group by t.status`,
  );
  const [result] = await runAs(db, actor, db.execute(sql.join(pieces, sql` union all `)));
  const rows = rowsOf<{ type: ContentTypeKey; status: ListItem["status"]; n: number; warn: number }>(result);
  return defs.map((def) => {
    const mine = rows.filter((r) => r.type === def.type);
    const n = (status: ListItem["status"]) => mine.find((r) => r.status === status)?.n ?? 0;
    return { type: def.type, draft: n("draft"), published: n("published"), archived: n("archived"), warnings: mine.reduce((sum, r) => sum + r.warn, 0) };
  });
}

export interface StaleItem {
  type: "fees" | "campus" | "resources";
  id: string;
  label: string;
  version: string;
  /** When the fee was last updated, or the link last checked. Null: never checked. */
  checkedAt: string | null;
}

/** B8: published fees not updated for `stale_fee_days` and published links not checked for `stale_tour_days` (S6.5). A query, not a job. */
export async function staleItems(db: Db, actor: Actor): Promise<StaleItem[]> {
  const [result] = await runAs(db, actor, staleQuery(db));
  return staleItemsOf(result);
}

/** The statement behind `staleItems`, for a screen that runs it together with its other reads in one round trip (the Health page). */
export function staleQuery(db: Db) {
  const piece = (def: TypeDef, checked: string) =>
    sql`select ${def.type}::text as type, t.id, ${sql.raw(LABEL[def.type])} as label, ${versionExpr("t")} as version, t.${sql.raw(checked)} as checked_at from ${table(def)} t where ${flagExpr(def)} = 'stale'`;
  return db.execute(sql`${piece(TYPE_DEFS.fees, "last_updated_at")} union all ${piece(TYPE_DEFS.campus, "url_last_checked_at")} union all ${piece(TYPE_DEFS.resources, "url_last_checked_at")} order by checked_at nulls first`);
}

export function staleItemsOf(result: unknown): StaleItem[] {
  return rowsOf<{ type: StaleItem["type"]; id: string; label: string; version: string; checked_at: string | Date | null }>(result).map((r) => ({
    type: r.type,
    id: r.id,
    label: r.label,
    version: r.version,
    checkedAt: r.checked_at ? new Date(r.checked_at).toISOString() : null,
  }));
}
