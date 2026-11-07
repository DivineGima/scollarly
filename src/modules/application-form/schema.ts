import * as z from "zod";
import { countryCodeSchema, requiredText, V } from "@/lib/schemas/common";
import { isValidBirthDate, normaliseFormPhone, PASSPORT_PATTERN } from "./service";

/**
 * The step-2 form (S17.2; FR-43, architecture 24.2). Strict, so an unknown field is refused. Messages are tokens the screen maps to words. The
 * name, WhatsApp number, course and year are not in it: they were given at sign-up and are shown prefilled and read-only.
 */

const text = (max: number) => requiredText(max);

const phone = z
  .string({ error: V.REQUIRED })
  .trim()
  .min(1, V.REQUIRED)
  .max(30, V.TOO_LONG)
  .transform((value, ctx) => {
    const normalised = normaliseFormPhone(value);
    if (normalised === null) ctx.addIssue({ code: "custom", message: V.PHONE_INVALID });
    return normalised ?? "";
  });

export const GENDERS = ["female", "male", "other"] as const;

export const formBody = z.strictObject({
  dateOfBirth: z
    .string({ error: V.REQUIRED })
    .min(1, V.REQUIRED)
    .refine((v) => isValidBirthDate(v), V.INVALID),
  gender: z.enum(GENDERS, { error: V.UNKNOWN_VALUE }),
  nationality: countryCodeSchema,
  residenceState: text(120),
  city: text(120),
  address: text(300),
  guardianName: text(120),
  guardianPhone: phone,
  motherName: text(120),
  motherPhone: phone,
  /** Needed only when the university asks (checked against the database, not here). Blank is the same as absent. */
  passportNumber: z
    .string({ error: V.INVALID })
    .trim()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || PASSPORT_PATTERN.test(v), V.INVALID)
    .optional(),
});
export type FormBody = z.infer<typeof formBody>;
