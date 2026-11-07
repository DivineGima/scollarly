import * as z from "zod";
import { uuidSchema, V } from "@/lib/schemas/common";

/** One email, lower case, as typed by the owner. Google reports the address in the form it holds, so the comparison is case-insensitive. */
export const emailSchema = z.string({ error: V.REQUIRED }).trim().toLowerCase().max(254, V.TOO_LONG).pipe(z.email({ error: V.INVALID }));

export const inviteBody = z.strictObject({ email: emailSchema, role: z.enum(["manager", "admin"], { error: V.UNKNOWN_VALUE }).default("manager") });
/** An admin moves a student to another manager, or back to nobody (null). Both ids are user tokens. */
export const reassignBody = z.strictObject({
  studentId: z.string({ error: V.REQUIRED }).min(1, V.REQUIRED).max(64, V.TOO_LONG),
  managerId: z.string({ error: V.REQUIRED }).min(1, V.REQUIRED).max(64, V.TOO_LONG).nullable(),
});
/** A manager or admin sets their own away switch and WhatsApp number (E.164, or null to clear it). At least one of `away` and `whatsapp` is sent. */
export const staffSettingsBody = z
  .strictObject({
    away: z.boolean({ error: V.INVALID }).optional(),
    whatsapp: z.string({ error: V.INVALID }).regex(/^[+][1-9][0-9]{6,14}$/, V.INVALID).nullable().optional(),
  })
  .refine((value) => value.away !== undefined || value.whatsapp !== undefined, { error: V.REQUIRED });
export const revokeInviteBody = z.strictObject({ id: uuidSchema });
export const removeManagerBody = z.strictObject({ userId: z.string({ error: V.REQUIRED }).min(1, V.REQUIRED).max(64, V.TOO_LONG) });
