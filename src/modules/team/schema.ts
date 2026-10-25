import * as z from "zod";
import { uuidSchema, V } from "@/lib/schemas/common";

/** One email, lower case, as typed by the owner. Google reports the address in the form it holds, so the comparison is case-insensitive. */
export const emailSchema = z.string({ error: V.REQUIRED }).trim().toLowerCase().max(254, V.TOO_LONG).pipe(z.email({ error: V.INVALID }));

export const inviteBody = z.strictObject({ email: emailSchema });
export const revokeInviteBody = z.strictObject({ id: uuidSchema });
export const removeAdminBody = z.strictObject({ userId: z.string({ error: V.REQUIRED }).min(1, V.REQUIRED).max(64, V.TOO_LONG) });
