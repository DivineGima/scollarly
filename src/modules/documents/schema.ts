import * as z from "zod";
import { DOCUMENT_CONTENT_TYPES, LETTER_KINDS, MAX_DOCUMENT_BYTES, STUDENT_DOCUMENT_KINDS } from "@/lib/constants";
import { requiredText, uuidSchema, V } from "@/lib/schemas/common";

/**
 * The bodies and queries of the document operations (architecture 24.5). Strict, so an unknown field is refused; messages are tokens the
 * screen maps to words. The file itself is never in a body: it goes from the phone straight to storage.
 */

export const signBody = z.strictObject({
  kind: z.enum(STUDENT_DOCUMENT_KINDS, { error: V.UNKNOWN_VALUE }),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES, { error: V.UNKNOWN_VALUE }),
  byteSize: z.number({ error: V.INVALID }).int(V.INVALID).min(1, V.INVALID).max(MAX_DOCUMENT_BYTES, "TOO_LARGE"),
});
export type SignBody = z.infer<typeof signBody>;

export const confirmBody = z.strictObject({ id: uuidSchema });

/** Approve, or ask for a clearer photo: a reason is required for the second and ignored for the first. */
export const reviewBody = z
  .strictObject({
    id: uuidSchema,
    decision: z.enum(["approved", "rejected"], { error: V.UNKNOWN_VALUE }),
    note: requiredText(300).optional(),
  })
  .refine((b) => b.decision === "approved" || b.note !== undefined, { path: ["note"], message: V.REQUIRED });

export const idQuery = z.strictObject({ id: uuidSchema });
export const studentQuery = z.strictObject({ studentId: requiredText(64) });

/** The admin uploads a letter (a PDF) for a student: which student, which letter, and its size. */
export const signLetterBody = z.strictObject({
  studentId: requiredText(64),
  kind: z.enum(LETTER_KINDS, { error: V.UNKNOWN_VALUE }),
  /** The upload helper announces the type of the file it was given, as it does for a student; a letter is always a PDF, so anything else is refused here. */
  contentType: z.literal("application/pdf", { error: V.UNKNOWN_VALUE }).optional(),
  byteSize: z.number({ error: V.INVALID }).int(V.INVALID).min(1, V.INVALID).max(MAX_DOCUMENT_BYTES, "TOO_LARGE"),
});

/** The admin approves the student's proof of payment (FR-46). */
export const approveProofBody = z.strictObject({ id: uuidSchema });
