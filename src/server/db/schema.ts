import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CAMPUS_EXPERIENCE_KINDS,
  CLAIM_METHODS,
  CLAIM_STATUSES,
  CONSENT_SCOPES,
  CONTENT_STATUSES,
  CURRENCIES,
  DATA_REQUEST_CHANNELS,
  DATA_REQUEST_KINDS,
  DATA_REQUEST_STATUSES,
  DUPLICATE_DECISIONS,
  EVENT_TYPES,
  INTAKE_KINDS,
  LEAD_ACTIVITY_TYPES,
  PROCESS_STEP_KINDS,
  QUALIFICATION_TYPES,
  VERIFICATION_METHODS,
} from "../../lib/constants";
import type { Translations } from "../../lib/translations";

/**
 * The schema (architecture 7). All timestamps are `timestamptz` (UTC in storage). Application ids are UUID v7 generated
 * by the application (`src/lib/uuid.ts`), so no id has a database default.
 *
 * Sections:
 *  1. Identity tables (7.1, ADR-037). Neon Auth owns the users and sessions in its own schema.
 *  2. Media metadata (7.4). Image bytes live in Neon Object Storage (ADR-039), not in a table.
 *  3. Leads (7.2).
 *  4. Content (7.3) and site settings.
 *  5. Analytics (7.5) and payments (7.6).
 *  6. Phase 0 throwaway tables. They are additive, hold no real data and are marked deprecated; the stub is removed in a
 *     later version once nothing references it (architecture 14, feature removal).
 *
 * Every table gets row level security in the same migration that creates it (ADR-038); see
 * `src/server/db/migrations/0003_stage1_foundation.sql` and the every-table tests.
 *
 * History columns (`actor_id`, `author_id`, `entered_by`, `decided_by`, `handled_by`) are plain text without a foreign key
 * on purpose: an audit trail must outlive the account of the person it names (erasure deletes the account row, ADR-029).
 */

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** `('a', 'b')` for a CHECK list. The values are constants from `src/lib/constants.ts`, never user input. */
const list = (values: readonly string[]) => sql.raw(`(${values.map((v) => `'${v}'`).join(", ")})`);

// ---------------------------------------------------------------------------------------------
// 1. Identity (ADR-037). Sign-in and sessions are Neon Auth (managed Better Auth, schema `neon_auth`), which our
//    code never writes. These are OUR tables: the role, the owner second factor and the step-up time.
//    `app_user.id` is the Neon Auth user id as text, with no foreign key across schemas.
// ---------------------------------------------------------------------------------------------

export const appUser = pgTable(
  "app_user",
  {
    id: text("id").primaryKey(),
    /** `student` (default) / `admin` / `owner`. Created idempotently by `app_resolve_session` on the first authenticated request. */
    role: text("role").notNull().default("student"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("app_user_role_check", sql`${t.role} in ('student', 'admin', 'owner')`),
    // Exactly one owner can ever exist (ADR-013).
    uniqueIndex("app_user_single_owner").on(t.role).where(sql`${t.role} = 'owner'`),
  ],
);

/** The owner's authenticator-app secret (ADR-037). The secret is AES-GCM encrypted with a Worker secret. */
export const ownerTotp = pgTable("owner_totp", {
  userId: text("user_id")
    .primaryKey()
    .references(() => appUser.id),
  secretEncrypted: text("secret_encrypted").notNull(),
  /** False until the owner proves the first code during enrolment. */
  confirmed: boolean("confirmed").notNull().default(false),
  enrolledAt: tz("enrolled_at").notNull().defaultNow(),
  /** The last accepted 30 second time step. A code for the same or an earlier step is refused (replay). */
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
  failedCount: integer("failed_count").notNull().default(0),
  lockedUntil: tz("locked_until"),
});

/** Ten single-use recovery codes per owner, stored as hashes only. */
export const recoveryCode = pgTable(
  "recovery_code",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => appUser.id),
    codeHash: text("code_hash").notNull(),
    usedAt: tz("used_at"),
  },
  (t) => [uniqueIndex("recovery_code_user_hash").on(t.userId, t.codeHash)],
);

/** When a Neon Auth session last passed the second factor. Read by the facade for "2FA verified" and the 10-minute step-up. */
export const stepUp = pgTable("step_up", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => appUser.id),
  verifiedAt: tz("verified_at").notNull(),
});

/** Admin invites (architecture 9.4). The link is shown to the owner to copy; only its hash is stored. No email is sent (ADR-036). */
export const adminInvite = pgTable(
  "admin_invite",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    acceptedAt: tz("accepted_at"),
    revokedAt: tz("revoked_at"),
  },
  (t) => [
    check("admin_invite_expiry_check", sql`${t.expiresAt} > ${t.createdAt}`),
    // S2.5: one open invite per email, so a double tap on "Send invite" cannot create two. Resend revokes the old one first.
    uniqueIndex("admin_invite_one_open_per_email").on(sql`lower(${t.email})`).where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

/** Append-only (architecture 7.1): the runtime role has no update or delete right. `meta` holds ids and changed field names only, no personal data. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),
  /** Null for the system (cron, migrations). */
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  at: tz("at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------------------------
// 2. Media (architecture 7.4)
// ---------------------------------------------------------------------------------------------

export const mediaAsset = pgTable(
  "media_asset",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    alt: jsonb("alt").$type<Record<string, string>>().notNull().default({}),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    mime: text("mime").notNull(),
    sha256: text("sha256").notNull().unique(),
    createdBy: text("created_by"),
    createdAt: tz("created_at").notNull().defaultNow(),
    archivedAt: tz("archived_at"),
  },
  (t) => [
    check("media_asset_kind_check", sql`${t.kind} in ('logo', 'photo', 'blog', 'testimonial', 'other')`),
    check("media_asset_mime_check", sql`${t.mime} = 'image/webp'`),
  ],
);

// ---------------------------------------------------------------------------------------------
// 3. Leads (architecture 7.2)
// ---------------------------------------------------------------------------------------------

/** The six stages, seeded by the migration (ADR-021). `name` is translatable text. */
export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    code: text("code").primaryKey(),
    position: integer("position").notNull().unique(),
    name: jsonb("name").$type<Translations>().notNull(),
  },
  (t) => [check("pipeline_stage_name_object", sql`jsonb_typeof(${t.name}) = 'object'`)],
);

export const lead = pgTable(
  "lead",
  {
    id: uuid("id").primaryKey(),
    /** `SC-XXXXX-XXXXX` (ADR-006). The server's reference; the device's own value is `clientRef`. */
    ref: text("ref").notNull().unique(),
    clientRef: text("client_ref").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    payloadHash: text("payload_hash").notNull(),
    /** Null only once the lead is anonymised (erasure, architecture 7.9). */
    name: text("name"),
    /** E.164, for example `+237612345678`. Null only once the lead is anonymised. */
    whatsappE164: text("whatsapp_e164"),
    countryCode: text("country_code").notNull(),
    email: text("email"),
    intakeKind: text("intake_kind").notNull().default("full"),
    /** Null only for a `quick` lead (ADR-030). */
    qualificationType: text("qualification_type"),
    /** A list of `{ subject, grade }`. Empty for a quick lead. */
    results: jsonb("results").$type<{ subject: string; grade: string }[]>().notNull().default([]),
    /** `{ page, university_id, programme_id, utm }` (architecture 8.2). */
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    locale: text("locale").notNull().default("en"),
    stageCode: text("stage_code")
      .notNull()
      .default("share_results")
      .references(() => pipelineStage.code),
    assignedAdminId: text("assigned_admin_id").references(() => appUser.id),
    userId: text("user_id").references(() => appUser.id),
    consentNoticeVersion: text("consent_notice_version").notNull(),
    consentAt: tz("consent_at").notNull(),
    /** Advisory only: the device clock is never trusted (ADR-009). */
    clientCreatedAt: tz("client_created_at"),
    /** Server time at insert. Starts the SLA clock (architecture 10.7). */
    receivedAt: tz("received_at").notNull().defaultNow(),
    /** Set once at insert from the WAT weekday and never recalculated (FR-12). */
    slaDueAt: tz("sla_due_at").notNull(),
    slaHoursApplied: integer("sla_hours_applied").notNull(),
    firstResponseAt: tz("first_response_at"),
    lastActivityAt: tz("last_activity_at").notNull().defaultNow(),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => lead.id),
    anonymisedAt: tz("anonymised_at"),
  },
  (t) => [
    check("lead_ref_format", sql`${t.ref} ~ '^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$'`),
    check("lead_client_ref_format", sql`${t.clientRef} ~ '^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$'`),
    check("lead_payload_hash_format", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check("lead_country_code_format", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check("lead_intake_kind_check", sql`${t.intakeKind} in ${list(INTAKE_KINDS)}`),
    check("lead_qualification_type_check", sql`${t.qualificationType} is null or ${t.qualificationType} in ${list(QUALIFICATION_TYPES)}`),
    // Architecture 7.2: qualification_type is null only when intake_kind is quick.
    check("lead_qualification_required_for_full", sql`${t.intakeKind} = 'quick' or ${t.qualificationType} is not null`),
    check("lead_results_is_array", sql`jsonb_typeof(${t.results}) = 'array'`),
    check("lead_quick_has_no_results", sql`${t.intakeKind} = 'full' or ${t.results} = '[]'::jsonb`),
    check("lead_source_is_object", sql`jsonb_typeof(${t.source}) = 'object'`),
    check("lead_sla_hours_positive", sql`${t.slaHoursApplied} > 0`),
    check("lead_not_merged_into_itself", sql`${t.mergedIntoId} is null or ${t.mergedIntoId} <> ${t.id}`),
    // A live lead has a name and a valid E.164 number; an anonymised one has none of name, number and email, and no results (7.9).
    check(
      "lead_identity_or_anonymised",
      sql`(${t.anonymisedAt} is null and ${t.name} is not null and btrim(${t.name}) <> '' and ${t.whatsappE164} is not null and ${t.whatsappE164} ~ '^[+][1-9][0-9]{6,14}$')
        or (${t.anonymisedAt} is not null and ${t.name} is null and ${t.whatsappE164} is null and ${t.email} is null and ${t.results} = '[]'::jsonb)`,
    ),
    index("lead_client_ref_idx").on(t.clientRef),
    index("lead_whatsapp_e164_idx").on(t.whatsappE164),
    index("lead_received_at_idx").on(t.receivedAt.desc()),
    index("lead_stage_assigned_idx").on(t.stageCode, t.assignedAdminId),
    index("lead_sla_due_open_idx").on(t.slaDueAt).where(sql`${t.firstResponseAt} is null`),
    // Not in the 7.8 list: the student policy and the portal read leads by user_id.
    index("lead_user_id_idx").on(t.userId),
  ],
);

export const leadProgrammePref = pgTable(
  "lead_programme_pref",
  {
    leadId: uuid("lead_id")
      .notNull()
      .references(() => lead.id),
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => programme.id),
    rank: integer("rank").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.leadId, t.programmeId] }),
    unique("lead_programme_pref_rank").on(t.leadId, t.rank),
    check("lead_programme_pref_rank_positive", sql`${t.rank} >= 1`),
  ],
);

/**
 * Append-only with no exception (ADR-007): the runtime role has no update or delete right. `data` holds ids, stage codes
 * and type-specific codes, never free text; a `note` activity holds the `lead_note` id.
 */
export const leadActivity = pgTable(
  "lead_activity",
  {
    id: uuid("id").primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => lead.id),
    type: text("type").notNull(),
    /** Null for the system. */
    actorId: text("actor_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("lead_activity_type_check", sql`${t.type} in ${list(LEAD_ACTIVITY_TYPES)}`),
    check("lead_activity_data_is_object", sql`jsonb_typeof(${t.data}) = 'object'`),
    index("lead_activity_lead_created_idx").on(t.leadId, t.createdAt),
  ],
);

/** The only place admin free text about a lead lives. Erasure overwrites `body` and sets `erasedAt` (ADR-007, 7.9). */
export const leadNote = pgTable("lead_note", {
  id: uuid("id").primaryKey(),
  leadId: uuid("lead_id")
    .notNull()
    .references(() => lead.id),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
  erasedAt: tz("erased_at"),
});

export const leadClaim = pgTable(
  "lead_claim",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => appUser.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => lead.id),
    method: text("method").notNull(),
    status: text("status").notNull().default("pending"),
    /** Required when the claim is approved (architecture 9.6, ADR-015). */
    verificationMethod: text("verification_method"),
    decidedBy: text("decided_by"),
    decidedAt: tz("decided_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("lead_claim_method_check", sql`${t.method} in ${list(CLAIM_METHODS)}`),
    check("lead_claim_status_check", sql`${t.status} in ${list(CLAIM_STATUSES)}`),
    check("lead_claim_verification_check", sql`${t.verificationMethod} is null or ${t.verificationMethod} in ${list(VERIFICATION_METHODS)}`),
    check("lead_claim_approval_needs_method", sql`${t.status} <> 'approved' or ${t.verificationMethod} is not null`),
    index("lead_claim_lead_idx").on(t.leadId),
    index("lead_claim_user_idx").on(t.userId),
  ],
);

export const leadDuplicateDecision = pgTable(
  "lead_duplicate_decision",
  {
    id: uuid("id").primaryKey(),
    leadAId: uuid("lead_a_id")
      .notNull()
      .references(() => lead.id),
    leadBId: uuid("lead_b_id")
      .notNull()
      .references(() => lead.id),
    decision: text("decision").notNull(),
    decidedBy: text("decided_by").notNull(),
    decidedAt: tz("decided_at").notNull().defaultNow(),
  },
  (t) => [
    check("lead_duplicate_decision_check", sql`${t.decision} in ${list(DUPLICATE_DECISIONS)}`),
    check("lead_duplicate_distinct", sql`${t.leadAId} <> ${t.leadBId}`),
  ],
);

export const dataRequest = pgTable(
  "data_request",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    /** No foreign key: an erasure request must outlive the account it erased. */
    userId: text("user_id"),
    leadId: uuid("lead_id").references(() => lead.id),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("open"),
    handledBy: text("handled_by"),
    completedAt: tz("completed_at"),
    note: text("note"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("data_request_kind_check", sql`${t.kind} in ${list(DATA_REQUEST_KINDS)}`),
    check("data_request_channel_check", sql`${t.channel} in ${list(DATA_REQUEST_CHANNELS)}`),
    check("data_request_status_check", sql`${t.status} in ${list(DATA_REQUEST_STATUSES)}`),
  ],
);

// ---------------------------------------------------------------------------------------------
// 4. Content (architecture 7.3). Translatable text is in `translations` (ADR-008).
// ---------------------------------------------------------------------------------------------

/** The columns every content table has: status, publication time, authorship and the `updated_at` used for optimistic concurrency (ADR-017). */
const contentColumns = () => ({
  status: text("status").notNull().default("draft"),
  publishedAt: tz("published_at"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

const sortOrder = () => integer("sort_order").notNull().default(0);

const translations = () => jsonb("translations").$type<Translations>().notNull().default({});

export const university = pgTable(
  "university",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    city: text("city"),
    state: text("state"),
    type: text("type"),
    naacGrade: text("naac_grade"),
    websiteUrl: text("website_url"),
    logoMediaId: uuid("logo_media_id").references(() => mediaAsset.id),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("university_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("university_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("university_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("university_status_sort_idx").on(t.status, t.sortOrder),
  ],
);

export const programme = pgTable(
  "programme",
  {
    id: uuid("id").primaryKey(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => university.id),
    name: text("name").notNull(),
    level: text("level"),
    field: text("field"),
    durationMonths: integer("duration_months"),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("programme_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("programme_duration_positive", sql`${t.durationMonths} is null or ${t.durationMonths} > 0`),
    check("programme_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("programme_status_sort_idx").on(t.status, t.sortOrder),
    index("programme_university_idx").on(t.universityId),
  ],
);

export const feeStructure = pgTable(
  "fee_structure",
  {
    id: uuid("id").primaryKey(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => university.id),
    programmeId: uuid("programme_id").references(() => programme.id),
    currency: text("currency").notNull(),
    amountMin: numeric("amount_min", { precision: 12, scale: 2 }),
    amountMax: numeric("amount_max", { precision: 12, scale: 2 }),
    period: text("period").notNull(),
    /** FR-2: a fee is shown only when this is true, and then the range below is valid (CHECK). */
    dataConfirmed: boolean("data_confirmed").notNull().default(false),
    lastUpdatedAt: tz("last_updated_at").notNull().defaultNow(),
    sourceUrl: text("source_url"),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("fee_structure_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("fee_structure_currency_check", sql`${t.currency} in ${list(CURRENCIES)}`),
    // FR-2 in the database too: a confirmed fee has a real range. A NULL amount fails the first two tests, so null is never "confirmed".
    check(
      "fee_structure_confirmed_range",
      sql`not ${t.dataConfirmed} or (${t.amountMin} is not null and ${t.amountMax} is not null and ${t.amountMin} > 0 and ${t.amountMax} >= ${t.amountMin})`,
    ),
    check("fee_structure_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("fee_structure_status_sort_idx").on(t.status, t.sortOrder),
    index("fee_structure_university_idx").on(t.universityId),
  ],
);

export const campusExperience = pgTable(
  "campus_experience",
  {
    id: uuid("id").primaryKey(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => university.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    /** FR-3: exactly 11 characters from `[a-zA-Z0-9_-]`. */
    youtubeId: text("youtube_id"),
    url: text("url"),
    thumbnailMediaId: uuid("thumbnail_media_id").references(() => mediaAsset.id),
    urlLastCheckedAt: tz("url_last_checked_at"),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("campus_experience_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("campus_experience_kind_check", sql`${t.kind} in ${list(CAMPUS_EXPERIENCE_KINDS)}`),
    check("campus_experience_youtube_id_format", sql`${t.youtubeId} is null or ${t.youtubeId} ~ '^[a-zA-Z0-9_-]{11}$'`),
    check("campus_experience_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("campus_experience_status_sort_idx").on(t.status, t.sortOrder),
    index("campus_experience_university_idx").on(t.universityId),
  ],
);

export const officialResource = pgTable(
  "official_resource",
  {
    id: uuid("id").primaryKey(),
    universityId: uuid("university_id").references(() => university.id),
    title: text("title").notNull(),
    url: text("url").notNull(),
    kind: text("kind"),
    urlLastCheckedAt: tz("url_last_checked_at"),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("official_resource_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("official_resource_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("official_resource_status_sort_idx").on(t.status, t.sortOrder),
  ],
);

/** The record that a person agreed to be shown (FR-13). Revoking it unpublishes what depends on it (a service rule, S6.2). */
export const consentRecord = pgTable(
  "consent_record",
  {
    id: uuid("id").primaryKey(),
    subjectName: text("subject_name").notNull(),
    scope: text("scope").notNull(),
    evidenceNote: text("evidence_note"),
    grantedAt: tz("granted_at").notNull(),
    recordedBy: text("recorded_by"),
    revokedAt: tz("revoked_at"),
  },
  (t) => [check("consent_record_scope_check", sql`${t.scope} in ${list(CONSENT_SCOPES)}`)],
);

export const testimonial = pgTable(
  "testimonial",
  {
    id: uuid("id").primaryKey(),
    studentName: text("student_name").notNull(),
    country: text("country"),
    universityId: uuid("university_id").references(() => university.id),
    quote: text("quote").notNull(),
    photoMediaId: uuid("photo_media_id").references(() => mediaAsset.id),
    verified: boolean("verified").notNull().default(false),
    consentId: uuid("consent_id").references(() => consentRecord.id),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("testimonial_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    // FR-13 in the database too.
    check("testimonial_publish_gate", sql`${t.status} <> 'published' or (${t.verified} and ${t.consentId} is not null)`),
    check("testimonial_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("testimonial_status_sort_idx").on(t.status, t.sortOrder),
  ],
);

export const journey = pgTable(
  "journey",
  {
    id: uuid("id").primaryKey(),
    studentName: text("student_name").notNull(),
    country: text("country"),
    universityId: uuid("university_id").references(() => university.id),
    summary: text("summary").notNull(),
    verified: boolean("verified").notNull().default(false),
    consentId: uuid("consent_id").references(() => consentRecord.id),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("journey_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("journey_publish_gate", sql`${t.status} <> 'published' or (${t.verified} and ${t.consentId} is not null)`),
    check("journey_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("journey_status_sort_idx").on(t.status, t.sortOrder),
  ],
);

export const journeyStep = pgTable(
  "journey_step",
  {
    id: uuid("id").primaryKey(),
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => journey.id),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    dateLabel: text("date_label"),
  },
  (t) => [unique("journey_step_position").on(t.journeyId, t.position), check("journey_step_position_positive", sql`${t.position} >= 1`)],
);

export const teamMember = pgTable(
  "team_member",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    roleTitle: text("role_title").notNull(),
    bio: text("bio"),
    photoMediaId: uuid("photo_media_id").references(() => mediaAsset.id),
    confirmed: boolean("confirmed").notNull().default(false),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("team_member_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    // Unconfirmed bios are never published (CLAUDE.md guardrail).
    check("team_member_publish_gate", sql`${t.status} <> 'published' or ${t.confirmed}`),
    check("team_member_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("team_member_status_sort_idx").on(t.status, t.sortOrder),
  ],
);

export const faq = pgTable(
  "faq",
  {
    id: uuid("id").primaryKey(),
    category: text("category"),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("faq_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("faq_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("faq_status_sort_idx").on(t.status, t.sortOrder),
  ],
);

export const trustStat = pgTable(
  "trust_stat",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    confirmed: boolean("confirmed").notNull().default(false),
    asOf: date("as_of", { mode: "string" }),
    translations: translations(),
    sortOrder: sortOrder(),
    ...contentColumns(),
  },
  (t) => [
    check("trust_stat_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    // Unconfirmed statistics are never published (CLAUDE.md guardrail).
    check("trust_stat_publish_gate", sql`${t.status} <> 'published' or ${t.confirmed}`),
    check("trust_stat_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("trust_stat_status_sort_idx").on(t.status, t.sortOrder),
  ],
);

export const post = pgTable(
  "post",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** Markdown, sanitised on render (ADR-028). */
    body: text("body").notNull(),
    coverMediaId: uuid("cover_media_id").references(() => mediaAsset.id),
    authorId: text("author_id"),
    translations: translations(),
    ...contentColumns(),
  },
  (t) => [
    check("post_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("post_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("post_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("post_status_published_idx").on(t.status, t.publishedAt.desc()),
  ],
);

export const processStep = pgTable(
  "process_step",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    translations: translations(),
    ...contentColumns(),
  },
  (t) => [
    check("process_step_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("process_step_kind_check", sql`${t.kind} in ${list(PROCESS_STEP_KINDS)}`),
    check("process_step_position_positive", sql`${t.position} >= 1`),
    check("process_step_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("process_step_status_position_idx").on(t.status, t.kind, t.position),
  ],
);

/** Services copy, Why Scollarly, mission and values. `translations` is the whole text. */
export const contentBlock = pgTable(
  "content_block",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull().unique(),
    translations: translations(),
    ...contentColumns(),
  },
  (t) => [
    check("content_block_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`),
    check("content_block_translations_object", sql`jsonb_typeof(${t.translations}) = 'object'`),
  ],
);

/** Admin-to-student WhatsApp templates with placeholders `{name}` `{ref}` `{university}` (FR-11). Staff only. */
export const messageTemplate = pgTable(
  "message_template",
  {
    id: uuid("id").primaryKey(),
    stageCode: text("stage_code")
      .notNull()
      .references(() => pipelineStage.code),
    locale: text("locale").notNull(),
    body: text("body").notNull(),
    ...contentColumns(),
  },
  (t) => [check("message_template_status_check", sql`${t.status} in ${list(CONTENT_STATUSES)}`), index("message_template_stage_idx").on(t.stageCode, t.locale)],
);

/** Owner-editable settings (architecture 7.3). A JSON `null` value means not set; nothing here is invented. */
export const siteSetting = pgTable("site_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
});

// ---------------------------------------------------------------------------------------------
// 5. Analytics (7.5) and payments (7.6)
// ---------------------------------------------------------------------------------------------

export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey(),
    type: text("type").notNull(),
    /** Random per browsing session, not tied to a person. */
    sessionId: text("session_id"),
    leadRef: text("lead_ref"),
    leadId: uuid("lead_id").references(() => lead.id),
    universityId: uuid("university_id").references(() => university.id),
    pageGroup: text("page_group"),
    /** Taken from the edge request, never from the client. */
    country: text("country"),
    /** Client time, advisory only. */
    occurredAt: tz("occurred_at"),
    receivedAt: tz("received_at").notNull().defaultNow(),
  },
  (t) => [
    check("event_type_check", sql`${t.type} in ${list(EVENT_TYPES)}`),
    index("event_received_at_idx").on(t.receivedAt),
    index("event_lead_ref_idx").on(t.leadRef),
  ],
);

/**
 * Daily counts by WAT date (architecture 7.5). The key is the five dimension columns; country, university and page group
 * may be absent, so it is a UNIQUE NULLS NOT DISTINCT constraint rather than a primary key (a primary key column cannot
 * be null). The collector and the cron job upsert on it.
 */
export const eventDailyAgg = pgTable(
  "event_daily_agg",
  {
    date: date("date", { mode: "string" }).notNull(),
    type: text("type").notNull(),
    country: text("country"),
    universityId: uuid("university_id").references(() => university.id),
    pageGroup: text("page_group"),
    count: bigint("count", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    check("event_daily_agg_type_check", sql`${t.type} in ${list(EVENT_TYPES)}`),
    check("event_daily_agg_count_check", sql`${t.count} >= 0`),
    unique("event_daily_agg_key").on(t.date, t.type, t.country, t.universityId, t.pageGroup).nullsNotDistinct(),
  ],
);

/** The ledger of payments received from universities (ADR-012). USD cents only. Never updated except to void. */
export const placementPayment = pgTable(
  "placement_payment",
  {
    id: uuid("id").primaryKey(),
    /** Generated when the form opens, so a double tap or a replay inserts one row (13.5). */
    submissionToken: uuid("submission_token").notNull().unique(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => university.id),
    leadId: uuid("lead_id").references(() => lead.id),
    amountUsdCents: bigint("amount_usd_cents", { mode: "number" }).notNull(),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    note: text("note"),
    enteredBy: text("entered_by").notNull(),
    enteredAt: tz("entered_at").notNull().defaultNow(),
    voidedAt: tz("voided_at"),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
  },
  (t) => [
    check("placement_payment_amount_positive", sql`${t.amountUsdCents} > 0`),
    // All three void fields are null, or all are set with a non-blank reason (FR-17: a void requires a reason).
    check(
      "placement_payment_void_consistency",
      sql`(${t.voidedAt} is null and ${t.voidedBy} is null and ${t.voidReason} is null)
        or (${t.voidedAt} is not null and ${t.voidedBy} is not null and ${t.voidReason} is not null and btrim(${t.voidReason}) <> '')`,
    ),
    index("placement_payment_university_received_idx").on(t.universityId, t.receivedOn),
  ],
);

// ---------------------------------------------------------------------------------------------
// 6. Phase 0 throwaway tables
// ---------------------------------------------------------------------------------------------

/** @deprecated Stage 0 stub for the lead POST CPU gate. Replaced by the real `lead` table; removed in a later version once nothing references it. */
export const phase0LeadStub = pgTable(
  "phase0_lead_stub",
  {
    id: uuid("id").primaryKey(),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    payloadHash: text("payload_hash").notNull(),
    name: text("name").notNull(),
    whatsappE164: text("whatsapp_e164").notNull(),
    countryCode: text("country_code").notNull(),
    receivedAt: tz("received_at").notNull().defaultNow(),
  },
  (t) => [index("phase0_lead_stub_whatsapp_idx").on(t.whatsappE164)],
);

/** @deprecated Stage 0 content row used only to prove tag revalidation (S0.6). */
export const phase0Content = pgTable("phase0_content", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const schema = {
  appUser,
  ownerTotp,
  recoveryCode,
  stepUp,
  adminInvite,
  auditLog,
  mediaAsset,
  pipelineStage,
  lead,
  leadProgrammePref,
  leadActivity,
  leadNote,
  leadClaim,
  leadDuplicateDecision,
  dataRequest,
  university,
  programme,
  feeStructure,
  campusExperience,
  officialResource,
  consentRecord,
  testimonial,
  journey,
  journeyStep,
  teamMember,
  faq,
  trustStat,
  post,
  processStep,
  contentBlock,
  messageTemplate,
  siteSetting,
  event,
  eventDailyAgg,
  placementPayment,
  phase0LeadStub,
  phase0Content,
};
export type Schema = typeof schema;
