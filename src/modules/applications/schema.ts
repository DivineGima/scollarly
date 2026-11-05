import * as z from "zod";
import { REF_PATTERN } from "@/lib/ref";
import { isoDateTimeSchema, localeSchema, uuidSchema, V } from "@/lib/schemas/common";
import { MAX_PROGRAMMES, MIN_PROGRAMMES } from "./programmes";

/**
 * The body of `POST /api/v1/me/application` (PRD_4 F24, architecture 23.3). The application is made from the profile on the server, so the
 * body holds only which programmes the person chose, in order of preference (the first is the first choice), and the device's own
 * bookkeeping. Unknown fields are refused: nothing about who is applying can be sent. The idempotency key is a header, like every lead.
 */

export const applicationBodySchema = z
  .strictObject({
    programme_ids: z.array(uuidSchema, { error: V.REQUIRED }).max(MAX_PROGRAMMES, V.TOO_LONG),
    locale: localeSchema,
    /** The device-generated reference, `SC-XXXXX-XXXXX` (ADR-006): the first candidate for the lead's reference. */
    client_ref: z.string().regex(REF_PATTERN, V.INVALID),
    client_created_at: isoDateTimeSchema,
  })
  .superRefine((body, ctx) => {
    if (new Set(body.programme_ids).size !== body.programme_ids.length) {
      ctx.addIssue({ code: "custom", path: ["programme_ids"], message: V.DUPLICATE });
    } else if (body.programme_ids.length < MIN_PROGRAMMES) {
      ctx.addIssue({ code: "custom", path: ["programme_ids"], message: V.PROGRAMMES_MIN_3 });
    }
  });

export type ApplicationBody = z.infer<typeof applicationBodySchema>;
