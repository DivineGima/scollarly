import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
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
 *  1. Better Auth tables (architecture 7.1). Exact columns confirmed in Stage 0 by the auth integration test.
 *  2. Media tables, final shape from architecture 7.4 (S0.5 measures `bytea` reads on them).
 *  3. Phase 0 throwaway tables. They are additive, hold no real data, and are marked deprecated:
 *     Stage 1 (S1.1) owns the real `lead` table; the stub is removed in a later version once nothing references it.
 */

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** `bytea` column. node-postgres and the Neon driver return a Buffer; some paths return a `\x...` hex string. */
export const bytea = customType<{ data: Uint8Array; driverData: Buffer | Uint8Array | string }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => {
    if (typeof value === "string") return Uint8Array.from(Buffer.from(value.replace(/^\\x/, ""), "hex"));
    return value instanceof Uint8Array ? value : Uint8Array.from(value);
  },
});

// ---------------------------------------------------------------------------------------------
// 1. Better Auth
// ---------------------------------------------------------------------------------------------

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    /** `student` (default) / `admin` / `owner`. Architecture 7.1. */
    role: text("role").notNull().default("student"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  },
  (t) => [
    check("user_role_check", sql`${t.role} in ('student', 'admin', 'owner')`),
    // Exactly one owner can ever exist (ADR-013).
    uniqueIndex("user_single_owner").on(t.role).where(sql`${t.role} = 'owner'`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    /** Raw IP addresses are never stored (CLAUDE.md). Better Auth IP tracking is disabled, so this stays null. */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Set when the user last passed a TOTP or recovery-code check on this session (step-up, architecture 9.3). */
    twoFactorVerifiedAt: tz("two_factor_verified_at"),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    // Account lockout after repeated failed second-factor checks (Better Auth 1.7). Confirmed by the Stage 0 auth test.
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: tz("locked_until"),
  },
  (t) => [index("two_factor_user_id_idx").on(t.userId)],
);

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

/** Never selected by content queries. Only the `/media/[hash]` handler reads it. */
export const mediaBlob = pgTable("media_blob", {
  mediaId: uuid("media_id")
    .primaryKey()
    .references(() => mediaAsset.id),
  data: bytea("data").notNull(),
});

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

export const schema = { user, session, account, verification, twoFactor, mediaAsset, mediaBlob, phase0LeadStub, phase0Content };
export type Schema = typeof schema;
