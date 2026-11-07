import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/constants";

/**
 * The content check for an uploaded document (architecture 24.5, ADR-067). The browser says what the file is; the first bytes say what it
 * really is. A file counts as uploaded only when both agree and the size is inside the limit. Pure: the caller reads the bytes from storage.
 */

export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/** How many leading bytes `sniff` needs. */
export const SIGNATURE_BYTES = 8;

const startsWith = (bytes: Uint8Array, signature: readonly number[]) => bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);

/** The type the first bytes show: JPEG, PNG or PDF, or null for anything else. */
export function sniff(bytes: Uint8Array): DocumentContentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // "%PDF-"
  return null;
}

export function isDocumentContentType(value: string): value is DocumentContentType {
  return (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(value);
}

export type ContentVerdict = { ok: true } | { ok: false; reason: "empty" | "too_large" | "size_differs" | "type_differs" };

/**
 * `declared` is what the student said (the row); `actualSize` is what storage holds; `head` is the first bytes. The size must also match what
 * was declared when the link was signed, so a link cannot be used to put a different file there.
 */
export function checkContent(input: { declaredType: string; declaredSize: number; actualSize: number; head: Uint8Array }): ContentVerdict {
  if (input.actualSize <= 0) return { ok: false, reason: "empty" };
  if (input.actualSize > MAX_DOCUMENT_BYTES) return { ok: false, reason: "too_large" };
  if (input.actualSize !== input.declaredSize) return { ok: false, reason: "size_differs" };
  if (sniff(input.head) !== input.declaredType) return { ok: false, reason: "type_differs" };
  return { ok: true };
}
