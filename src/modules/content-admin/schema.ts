import * as z from "zod";
import { V } from "@/lib/schemas/common";
import { CONSENT_SCOPES, YOUTUBE_ID_PATTERN } from "@/lib/constants";
import { COPY_KEY_PATTERN, CONTENT_TYPE_KEYS, type ContentTypeKey, type FieldDef, type Gate, isYoutubeId, TYPE_DEFS, type TypeDef } from "./definitions";

/**
 * The Zod side of the content definitions (S6.1). The browser and the Worker both build their checks from `TYPE_DEFS`, so
 * the form and the server cannot disagree. Messages are tokens (`REQUIRED`, `TOO_LONG`, ...), never sentences (FR-15).
 * Blank optional text is stored as null, so "empty" has one spelling in the database.
 */

/** The `updated_at` of a row as text with microseconds, exactly as the server wrote it (same shape as a lead's version). */
export const versionSchema = z.string({ error: V.INVALID }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/, V.INVALID);

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** `err` is the token for a missing or wrongly typed value: REQUIRED for a required field, INVALID otherwise. */
function base(field: FieldDef, err: string): z.ZodType<unknown> {
  const max = field.max ?? 500;
  switch (field.kind) {
    case "text":
    case "textarea":
    case "markdown":
      return field.key === "key" && field.kind === "text"
        ? z.string({ error: err }).trim().max(max, V.TOO_LONG).regex(COPY_KEY_PATTERN, V.INVALID)
        : z.string({ error: err }).trim().max(max, V.TOO_LONG);
    case "slug":
      return z.string({ error: err }).trim().max(max, V.TOO_LONG).regex(SLUG, V.INVALID);
    case "url":
      return z.string({ error: err }).trim().max(max, V.TOO_LONG).refine(isHttps, V.INVALID);
    case "youtube":
      return z.string({ error: err }).trim().regex(YOUTUBE_ID_PATTERN, V.INVALID);
    case "number":
      return z.number({ error: err }).int(V.INVALID).min(field.min ?? 0, V.INVALID).max(field.max ?? 1_000_000, V.INVALID);
    case "money":
      // numeric(12,2): at most two decimals.
      return z
        .number({ error: err })
        .min(field.min ?? 0, V.INVALID)
        .max(9_999_999_999.99, V.INVALID)
        .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, V.INVALID);
    case "boolean":
      return z.boolean({ error: V.INVALID });
    case "select":
      return z.enum((field.options ?? []) as [string, ...string[]], { error: err === V.REQUIRED ? V.REQUIRED : V.UNKNOWN_VALUE });
    case "date":
      return z.string({ error: err }).regex(DATE, V.INVALID);
    case "media":
    case "ref":
      return field.ref === "stage" ? z.string({ error: err }).min(1, V.INVALID).max(40, V.INVALID) : z.uuid({ error: err === V.REQUIRED ? V.REQUIRED : V.INVALID });
  }
}

function fieldSchema(field: FieldDef): z.ZodType<unknown> {
  if (field.kind === "boolean") return z.boolean({ error: V.INVALID }).default(false);
  if (field.required) return z.preprocess(blankToNull, base(field, V.REQUIRED));
  return z.preprocess(blankToNull, base(field, V.INVALID).nullable()).optional().default(null);
}

export interface StepInput {
  title: string;
  body: string;
  dateLabel: string | null;
}

export const stepsSchema = z
  .array(
    z.strictObject({
      title: z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(200, V.TOO_LONG),
      body: z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(2000, V.TOO_LONG),
      dateLabel: z.preprocess(blankToNull, z.union([z.null(), z.string().trim().max(60, V.TOO_LONG)])).default(null),
    }),
  )
  .max(30, V.TOO_LONG);

/** The values of one item: every field of the type, nothing else. */
export function valuesSchema(def: TypeDef) {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const field of def.fields) shape[field.key] = fieldSchema(field);
  return z.strictObject(shape);
}

export type ContentValues = Record<string, unknown>;

export const typeSchema = z.enum(CONTENT_TYPE_KEYS as [ContentTypeKey, ...ContentTypeKey[]], { error: V.UNKNOWN_VALUE });

/** `content.save`: with no `id` the item is created; with an `id` and a `version` it is updated. */
export function saveBodyFor(def: TypeDef) {
  return z
    .strictObject({
      type: z.literal(def.type),
      id: z.uuid({ error: V.INVALID }).optional(),
      version: versionSchema.optional(),
      values: valuesSchema(def),
      steps: def.steps ? stepsSchema.optional() : z.undefined().optional(),
    })
    .refine((b) => (b.id === undefined) === (b.version === undefined), { path: ["version"], message: V.REQUIRED });
}

export const typeOnlyBody = z.looseObject({ type: typeSchema });

export const statusBody = z.strictObject({ type: typeSchema, id: z.uuid({ error: V.INVALID }), version: versionSchema });

export const markCheckedBody = statusBody;

export const consentCreateBody = z.strictObject({
  subjectName: z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(120, V.TOO_LONG),
  scope: z.enum(CONSENT_SCOPES, { error: V.UNKNOWN_VALUE }),
  /** How consent was obtained (FR-13): a record without it proves nothing. */
  evidenceNote: z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(1000, V.TOO_LONG),
  grantedOn: z.string({ error: V.REQUIRED }).regex(DATE, V.INVALID),
});

export const consentRevokeBody = z.strictObject({ id: z.uuid({ error: V.INVALID }) });

export const mediaAltBody = z.strictObject({ id: z.uuid({ error: V.INVALID }), alt: z.string({ error: V.INVALID }).trim().max(200, V.TOO_LONG) });
export const mediaArchiveBody = z.strictObject({ id: z.uuid({ error: V.INVALID }) });

/** The query of the list and item data calls. */
export const listQuery = z.strictObject({
  type: typeSchema,
  status: z.enum(["draft", "published", "archived"]).optional(),
  q: z.string().trim().max(100).optional(),
});
export const typeQuery = z.strictObject({ type: typeSchema });
export const itemQuery = z.strictObject({ type: typeSchema, id: z.uuid() });
export const mediaItemQuery = z.strictObject({ id: z.uuid() });

/** What the media upload takes besides the bytes (they are in the address because the body is the image). */
export const uploadQuery = z.strictObject({
  kind: z.enum(["logo", "photo", "blog", "testimonial", "other"]),
  alt: z.string().trim().max(200).optional(),
  document: z.enum(["0", "1"]).optional(),
  confirmed: z.enum(["0", "1"]).optional(),
});

// ----------------------------------------------------------------------------------------------------------------
// Publish gates (S6.2). The server runs them before it publishes, and the form reads the same result to say what is missing.
// The database CHECKs say the same things (architecture 7.3), so a gate that slipped through here still cannot be stored.
// ----------------------------------------------------------------------------------------------------------------

export type GateIssues = Record<string, string>;

export interface GateContext {
  /** The attached consent record was revoked. */
  consentRevoked?: boolean;
}

function has(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function gateIssue(gate: Gate, values: ContentValues, ctx: GateContext): GateIssues {
  switch (gate.kind) {
    case "required":
      return has(values[gate.field]) ? {} : { [gate.field]: "REQUIRED" };
    case "confirmed":
      return values[gate.field] === true ? {} : { [gate.field]: "NEEDS_CONFIRMED" };
    case "verifiedAndConsent": {
      const issues: GateIssues = {};
      if (values.verified !== true) issues.verified = "NEEDS_VERIFIED";
      if (!has(values.consentId)) issues.consentId = "NEEDS_CONSENT";
      else if (ctx.consentRevoked) issues.consentId = "CONSENT_REVOKED";
      return issues;
    }
    case "feeRange": {
      if (values.dataConfirmed !== true) return {};
      const min = typeof values.amountMin === "number" ? values.amountMin : null;
      const max = typeof values.amountMax === "number" ? values.amountMax : null;
      return min !== null && max !== null && min > 0 && max >= min ? {} : { amountMin: "FEE_RANGE", amountMax: "FEE_RANGE" };
    }
    case "campusLink": {
      if (values.kind === "video") return isYoutubeId(values.youtubeId) ? {} : { youtubeId: "NEEDS_YOUTUBE_ID" };
      return typeof values.url === "string" && isHttps(values.url) ? {} : { url: "NEEDS_HTTPS_URL" };
    }
  }
}

/** Everything that stops this item from being published, by field. An empty object means it may go live. */
export function publishIssues(def: TypeDef, values: ContentValues, ctx: GateContext = {}): GateIssues {
  return def.gates.reduce<GateIssues>((all, gate) => ({ ...all, ...gateIssue(gate, values, ctx) }), {});
}

export function defOf(type: ContentTypeKey): TypeDef {
  return TYPE_DEFS[type];
}

/**
 * A fee that is NOT confirmed may keep an empty or odd range, but a confirmed one needs a real range, and that is true for a
 * draft too (the database CHECK `fee_structure_confirmed_range` applies to every status). So a save checks this as well.
 */
export function saveIssues(def: TypeDef, values: ContentValues): GateIssues {
  return def.type === "fees" ? gateIssue({ kind: "feeRange" }, values, {}) : {};
}
