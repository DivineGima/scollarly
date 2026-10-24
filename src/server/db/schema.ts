import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Stage 0 schema. All timestamps are `timestamptz` (UTC in storage, architecture 7).
 *
 * Sections:
 *  1. Identity tables (architecture 7.1, ADR-037). Neon Auth owns the users and sessions in its own schema.
 *  2. Media metadata (architecture 7.4). Image bytes live in Neon Object Storage (ADR-039), not in a table.
 *  3. Phase 0 throwaway tables. They are additive, hold no real data, and are marked deprecated:
 *     Stage 1 (S1.1) owns the real `lead` table; the stub is removed in a later version once nothing references it.
 */

const tz = (name: string) => timestamp(name, { withTimezone: true });

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
// 3. Phase 0 throwaway tables
// ---------------------------------------------------------------------------------------------

/** @deprecated Stage 0 stub for the lead POST CPU gate. Replaced by the real `lead` table in S1.1. */
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

export const schema = { appUser, ownerTotp, recoveryCode, stepUp, mediaAsset, phase0LeadStub, phase0Content };
export type Schema = typeof schema;
