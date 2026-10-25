import * as z from "zod";
import { uuidSchema, V } from "@/lib/schemas/common";
import { VERSION_PATTERN } from "@/server/repositories/lead-admin";

/**
 * The query strings of the lead screens and the bodies of the lead operations (architecture 8.3, 16 B1 to B5). Every
 * schema is strict, so an unknown field is refused. Filters live in the URL (B2 step 2), so every screen's query is
 * parsed here and a value the screen could not have produced is a 400 with the field named, never a silent "show everything".
 */

const stageCode = z.string({ error: V.INVALID }).regex(/^[a-z][a-z0-9_]{0,39}$/, V.INVALID);
const userToken = z.string({ error: V.INVALID }).regex(/^[A-Za-z0-9._-]{1,64}$/, V.INVALID);

export const LEAD_VIEWS = ["all", "unanswered", "overdue", "unassigned"] as const;

/** A search is trimmed and kept short: it is matched with LIKE, so a very long one is never useful. */
const search = z.string({ error: V.INVALID }).trim().max(80, V.TOO_LONG);

export const leadsQuery = z.strictObject({
  view: z.enum(LEAD_VIEWS, { error: V.UNKNOWN_VALUE }).default("all"),
  stage: stageCode.optional(),
  country: z.string({ error: V.INVALID }).regex(/^[A-Z]{2}$/, V.INVALID).optional(),
  university: uuidSchema.optional(),
  /** `me`, `none`, or an admin's user id. */
  assigned: z.union([z.literal("me"), z.literal("none"), userToken]).optional(),
  q: search.optional(),
  /** The id of the last row already shown. */
  before: uuidSchema.optional(),
});
export type LeadsQuery = z.infer<typeof leadsQuery>;

export const leadIdQuery = z.strictObject({ id: uuidSchema });

export const dataRequestsQuery = z.strictObject({ status: z.enum(["open", "all"], { error: V.UNKNOWN_VALUE }).default("open") });

const version = z.string({ error: V.REQUIRED }).regex(VERSION_PATTERN, V.INVALID);

export const changeStageBody = z.strictObject({ leadId: uuidSchema, stage: stageCode, version });
export const assignBody = z.strictObject({ leadId: uuidSchema, adminId: userToken.nullable(), version });
export const addNoteBody = z.strictObject({
  leadId: uuidSchema,
  body: z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(2000, V.TOO_LONG),
});
export const leadIdBody = z.strictObject({ leadId: uuidSchema });
export const resolveDuplicateBody = z.strictObject({
  keepId: uuidSchema,
  otherId: uuidSchema,
  decision: z.enum(["merged", "not_duplicate"], { error: V.UNKNOWN_VALUE }),
});

/** Approving names how the student's identity was checked (architecture 9.6); a rejection carries a short reason. */
export const decideClaimBody = z.discriminatedUnion("decision", [
  z.strictObject({
    claimId: uuidSchema,
    decision: z.literal("approve"),
    verificationMethod: z.enum(["email_match", "whatsapp_confirmed"], { error: V.REQUIRED }),
  }),
  z.strictObject({
    claimId: uuidSchema,
    decision: z.literal("reject"),
    reason: z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(200, V.TOO_LONG),
  }),
]);

/** The identity box must be ticked: the schema accepts only `true`, so "false" and "missing" are both refused. */
export const eraseLeadBody = z.strictObject({
  leadId: uuidSchema,
  identityConfirmed: z.literal(true, { error: V.REQUIRED }),
  dataRequestId: uuidSchema.optional(),
});

export const leadRefSchema = z
  .string({ error: V.REQUIRED })
  .trim()
  .toUpperCase()
  .regex(/^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/, V.INVALID);

export const logDataRequestBody = z.strictObject({
  kind: z.enum(["export", "erasure"], { error: V.REQUIRED }),
  channel: z.enum(["whatsapp", "other"], { error: V.REQUIRED }),
  leadRef: leadRefSchema,
});
export const completeDataRequestBody = z.strictObject({ id: uuidSchema });
