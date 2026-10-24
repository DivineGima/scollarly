import { z } from "zod";
import { QUALIFICATION_TYPES } from "../constants";
import { normalisePhone } from "../phone";
import { REF_PATTERN } from "../ref";
import { countryCodeSchema, isoDateTimeSchema, localeSchema, requiredText, uuidSchema, V } from "./common";

/**
 * The body of `POST /api/v1/leads` (architecture 8.2, ADR-030). Unknown fields are rejected. The `Idempotency-Key` is a
 * header (`idempotencyKeySchema`) and is not part of the body, so it is not part of the payload hash either.
 *
 * Rules that cross fields (the lead rule of the Stage 1 exit criteria):
 *  - a `full` lead needs a qualification type and at least 3 different programmes;
 *  - a `quick` lead needs the page's university in `source` or at least 1 programme, and may have no qualification;
 *  - the number must normalise for the chosen country (the server stores the E.164 form, `normalisePhone`).
 */

export const resultEntrySchema = z.strictObject({
  subject: requiredText(60),
  grade: requiredText(10),
});

export const leadSourceSchema = z.strictObject({
  page: z.string().max(200, V.TOO_LONG).optional(),
  university_id: uuidSchema.optional(),
  programme_id: uuidSchema.optional(),
  utm: z
    .record(z.string().max(40, V.TOO_LONG), z.string().max(200, V.TOO_LONG))
    .refine((utm) => Object.keys(utm).length <= 8, V.TOO_LONG)
    .optional(),
});

const consentSchema = z.strictObject({ notice_version: requiredText(32) });

const common = {
  name: requiredText(100),
  whatsapp: requiredText(40),
  country_code: countryCodeSchema,
  email: z.email({ error: V.INVALID }).max(254, V.TOO_LONG).optional(),
  source: leadSourceSchema.default({}),
  locale: localeSchema,
  /** The device-generated reference, `SC-XXXXX-XXXXX` (ADR-006). */
  client_ref: z.string().regex(REF_PATTERN, V.INVALID),
  client_created_at: isoDateTimeSchema,
  consent: consentSchema,
  turnstile_token: z.string({ error: V.REQUIRED }).min(1, V.REQUIRED).max(2048, V.TOO_LONG),
};

type PhoneCheckInput = { whatsapp: string; country_code: string };

function checkPhone(value: PhoneCheckInput, ctx: z.RefinementCtx): void {
  if (!normalisePhone(value.whatsapp, value.country_code).ok) {
    ctx.addIssue({ code: "custom", path: ["whatsapp"], message: V.PHONE_INVALID });
  }
}

function checkDistinct(ids: readonly string[], ctx: z.RefinementCtx): void {
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["programme_ids"], message: V.DUPLICATE });
}

export const fullLeadSchema = z
  .strictObject({
    intake_kind: z.literal("full"),
    ...common,
    qualification_type: z.enum(QUALIFICATION_TYPES, { error: V.REQUIRED }),
    results: z.array(resultEntrySchema).max(30, V.TOO_LONG).default([]),
    /** In rank order: the first is the first choice. */
    programme_ids: z.array(uuidSchema).max(20, V.TOO_LONG),
  })
  .superRefine((lead, ctx) => {
    checkPhone(lead, ctx);
    checkDistinct(lead.programme_ids, ctx);
    if (new Set(lead.programme_ids).size < 3) ctx.addIssue({ code: "custom", path: ["programme_ids"], message: V.PROGRAMMES_MIN_3 });
  });

export const quickLeadSchema = z
  .strictObject({
    intake_kind: z.literal("quick"),
    ...common,
    programme_ids: z.array(uuidSchema).max(20, V.TOO_LONG).default([]),
  })
  .superRefine((lead, ctx) => {
    checkPhone(lead, ctx);
    checkDistinct(lead.programme_ids, ctx);
    if (!lead.source.university_id && lead.programme_ids.length < 1) {
      ctx.addIssue({ code: "custom", path: ["source", "university_id"], message: V.UNIVERSITY_OR_PROGRAMME_REQUIRED });
    }
  });

export const leadIntakeSchema = z.discriminatedUnion("intake_kind", [fullLeadSchema, quickLeadSchema], { error: V.UNKNOWN_VALUE });

export type LeadIntake = z.infer<typeof leadIntakeSchema>;
export type FullLeadIntake = z.infer<typeof fullLeadSchema>;
export type QuickLeadIntake = z.infer<typeof quickLeadSchema>;
