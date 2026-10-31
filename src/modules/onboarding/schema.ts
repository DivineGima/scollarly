import * as z from "zod";
import { PROFILE_RELATIONSHIPS } from "@/lib/constants";
import { REF_PATTERN } from "@/lib/ref";
import { isoDateTimeSchema, localeSchema, requiredText, V } from "@/lib/schemas/common";
import { type AnswerField, validateAnswers } from "./validate";

/**
 * The body of `POST /api/v1/me/onboarding` (architecture 21.6). Unknown fields are refused. The shape is checked here; every rule about
 * the answers is `validateAnswers`, the same function the phone runs before it lets a person press Next. The idempotency key is a
 * header, like `POST /api/v1/leads`, so it is not part of the payload hash.
 */
export const onboardingBodySchema = z
  .strictObject({
    relationship: z.enum(PROFILE_RELATIONSHIPS, { error: V.UNKNOWN_VALUE }),
    applicant_name: z.string({ error: V.REQUIRED }),
    applicant_country: z.string({ error: V.REQUIRED }),
    contact_name: z.string({ error: V.REQUIRED }),
    contact_country: z.string({ error: V.REQUIRED }),
    contact_whatsapp: z.string({ error: V.REQUIRED }),
    qualification_type: z.string({ error: V.REQUIRED }),
    results: z.array(z.strictObject({ subject: z.string({ error: V.INVALID }), grade: z.string({ error: V.INVALID }) }), { error: V.INVALID }),
    level: z.string({ error: V.REQUIRED }),
    course_fields: z.array(z.string({ error: V.UNKNOWN_VALUE }), { error: V.REQUIRED }),
    intake_year: z.number({ error: V.REQUIRED }),
    locale: localeSchema,
    /** The device-generated reference, `SC-XXXXX-XXXXX` (ADR-006). */
    client_ref: z.string().regex(REF_PATTERN, V.INVALID),
    client_created_at: isoDateTimeSchema,
    consent: z.strictObject({ notice_version: requiredText(32) }),
  })
  .superRefine((body, ctx) => {
    const errors = validateAnswers(body);
    for (const [field, token] of Object.entries(errors) as [AnswerField, string][]) {
      ctx.addIssue({ code: "custom", path: [field], message: token });
    }
  });

export type OnboardingBody = z.infer<typeof onboardingBodySchema>;
