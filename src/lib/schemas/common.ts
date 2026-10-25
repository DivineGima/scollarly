import * as z from "zod";
import { locales } from "@/i18n/config";
import { CONTENT_STATUSES, STUDENT_COUNTRIES } from "../constants";

/**
 * Shared Zod schemas (architecture 15: Zod is the single definition of every boundary shape, shared by client and
 * server). Error messages are stable tokens, not sentences: the UI maps a token to a translation key (FR-15), so no
 * English text leaks from the server into a French page later.
 */

/** Message tokens carried in the `fields` of the error envelope. */
export const V = {
  REQUIRED: "REQUIRED",
  TOO_LONG: "TOO_LONG",
  INVALID: "INVALID",
  UNKNOWN_VALUE: "UNKNOWN_VALUE",
  DUPLICATE: "DUPLICATE",
  PHONE_INVALID: "PHONE_INVALID",
  PROGRAMMES_MIN_3: "PROGRAMMES_MIN_3",
  UNIVERSITY_OR_PROGRAMME_REQUIRED: "UNIVERSITY_OR_PROGRAMME_REQUIRED",
} as const;

/** A trimmed, required text of at most `max` characters. */
export const requiredText = (max: number) => z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(max, V.TOO_LONG);

export const uuidSchema = z.uuid({ error: V.INVALID });

/** The `Idempotency-Key` header of `POST /api/v1/leads` (architecture 8.2). */
export const idempotencyKeySchema = uuidSchema;

export const countryCodeSchema = z.enum(STUDENT_COUNTRIES, { error: V.UNKNOWN_VALUE });
export const localeSchema = z.enum(locales, { error: V.UNKNOWN_VALUE });
export const contentStatusSchema = z.enum(CONTENT_STATUSES, { error: V.UNKNOWN_VALUE });

/**
 * Translatable text (architecture 6.4): an object keyed by locale with `en` required, other locales optional text.
 * The database only checks that the value is an object; this schema is applied where content is written (Stage 6).
 */
export const translationsSchema = z.object({ en: requiredText(20000) }).catchall(z.string().max(20000, V.TOO_LONG));

/** An ISO 8601 date and time with an offset or `Z`, for example `2026-10-23T22:00:00Z`. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true, error: V.INVALID });

/** The error envelope every non-2xx JSON response carries (architecture 8.1). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
  request_id: z.string(),
});
export type ErrorEnvelopeShape = z.infer<typeof errorEnvelopeSchema>;
