import * as z from "zod";
import { uuidSchema, V } from "@/lib/schemas/common";
import { isCalendarDate, parseUsdToCents } from "./service";

/**
 * The query string of the Payments screen and the bodies of the two ledger operations (architecture 8.3, 16 B9). Every schema is
 * strict, so an unknown field is refused. Error messages are tokens, which the screen maps to words.
 */

export const PAYMENT_STATUSES = ["all", "active", "voided"] as const;

const date = z.string({ error: V.INVALID }).refine(isCalendarDate, V.INVALID);

export const paymentsQuery = z.strictObject({
  university: uuidSchema.optional(),
  from: date.optional(),
  to: date.optional(),
  status: z.enum(PAYMENT_STATUSES, { error: V.UNKNOWN_VALUE }).default("all"),
});
export type PaymentsQuery = z.infer<typeof paymentsQuery>;

export const leadSearchQuery = z.strictObject({ q: z.string({ error: V.INVALID }).trim().min(2, V.INVALID).max(60, V.TOO_LONG) });

export const recordBody = z.strictObject({
  /** Made when the form opens, so a double tap or a replay stores one payment (architecture 13.5). */
  submissionToken: uuidSchema,
  universityId: uuidSchema,
  leadId: uuidSchema.nullable().optional(),
  /** Dollars as typed. Turned into cents by `parseUsdToCents`, in one place. */
  amount: z.string({ error: V.REQUIRED }).refine((value) => parseUsdToCents(value) !== null, V.INVALID),
  receivedOn: date,
  note: z.string({ error: V.INVALID }).trim().max(500, V.TOO_LONG).nullable().optional(),
});
export type RecordBody = z.infer<typeof recordBody>;

export const voidBody = z.strictObject({
  id: uuidSchema,
  reason: z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(300, V.TOO_LONG),
});
