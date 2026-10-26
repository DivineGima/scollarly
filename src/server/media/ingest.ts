import { sha256Hex } from "@/lib/hash";
import { IMAGE_CAPS, type ImageKind } from "@/lib/image-caps";
import type { MediaStore } from "./store";

/**
 * Image ingestion (FR-18, S1.7): the checks and the storage steps for one WebP image, with no knowledge of the database
 * or of how the bytes were made. The caller supplies two small functions for the `media_asset` row, so the same code
 * serves the one-off import script now and the upload endpoint in Stage 6.
 *
 *  - the bytes must be a WebP file (signature and header are read, the file is not trusted by its name);
 *  - the size must fit the cap for the image kind (FR-18, proposed [Mine, confirm]: 300 KB photos, 50 KB logos);
 *  - the content hash is the identity: the same bytes are stored once, and an existing object is never overwritten
 *    (decision D17); there is no delete path.
 */

/** Size caps in bytes by `media_asset.kind` (shared with the browser, which shrinks pictures to fit them). */
export { IMAGE_CAPS, type ImageKind };

export type IngestErrorCode = "EMPTY" | "NOT_WEBP" | "TOO_LARGE";

export class IngestError extends Error {
  constructor(
    public readonly code: IngestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

const ascii = (bytes: Uint8Array, offset: number, length: number): string => String.fromCharCode(...bytes.subarray(offset, offset + length));
const u16 = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u24 = (b: Uint8Array, o: number): number => u16(b, o) | ((b[o + 2] ?? 0) << 16);
const u32 = (b: Uint8Array, o: number): number => (u24(b, o) | ((b[o + 3] ?? 0) << 24)) >>> 0;

/**
 * Reads the size of a WebP image from its header (RIFF container, then a VP8 lossy, VP8L lossless or VP8X extended
 * chunk). Returns null for anything that is not a complete WebP header, including a truncated file.
 */
export function parseWebp(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  if (u32(bytes, 4) + 8 > bytes.length) return null; // the RIFF size says more bytes than we have
  const chunk = ascii(bytes, 12, 4);
  let width: number;
  let height: number;
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null; // start code
    width = u16(bytes, 26) & 0x3fff;
    height = u16(bytes, 28) & 0x3fff;
  } else if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null; // signature
    const bits = u32(bytes, 21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === "VP8X") {
    width = u24(bytes, 24) + 1;
    height = u24(bytes, 27) + 1;
  } else {
    return null;
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

export interface NewMediaRow {
  id: string;
  kind: ImageKind;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  alt?: Record<string, string>;
}

export interface IngestDeps {
  store: Pick<MediaStore, "get" | "put">;
  /** The id of the `media_asset` row with this hash, archived or not, or null. */
  findIdBySha256: (sha256: string) => Promise<string | null>;
  /** Inserts the row; returns its id, or null when a row with the same hash already exists. */
  insert: (row: NewMediaRow) => Promise<string | null>;
  newId: () => string;
  /** Called for a NEW image only (not a duplicate), before anything is stored. It may throw to refuse it, for example when the storage budget is full. */
  guard?: (info: { bytes: number }) => Promise<void>;
}

export interface IngestResult {
  status: "created" | "existing";
  id: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
}

export async function ingestImage(deps: IngestDeps, input: { bytes: Uint8Array; kind: ImageKind; alt?: string }): Promise<IngestResult> {
  const { bytes, kind } = input;
  if (bytes.byteLength === 0) throw new IngestError("EMPTY", "The image is empty.");
  const size = parseWebp(bytes);
  if (!size) throw new IngestError("NOT_WEBP", "The file is not a complete WebP image.");
  if (bytes.byteLength > IMAGE_CAPS[kind]) {
    throw new IngestError("TOO_LARGE", `The image is ${bytes.byteLength} bytes; a ${kind} may be at most ${IMAGE_CAPS[kind]}.`);
  }

  const sha256 = await sha256Hex(bytes);
  const result = { sha256, width: size.width, height: size.height, bytes: bytes.byteLength };

  const existing = await deps.findIdBySha256(sha256);
  if (existing) return { status: "existing", id: existing, ...result };

  await deps.guard?.({ bytes: bytes.byteLength });

  // Store the object first, then the row, so a row never points at a missing object. If the object is already there
  // (a previous run stored it and stopped before inserting the row) it is left alone: it is immutable.
  if (!(await deps.store.get(sha256))) await deps.store.put(sha256, bytes);

  const inserted = await deps.insert({
    id: deps.newId(),
    kind,
    width: size.width,
    height: size.height,
    bytes: bytes.byteLength,
    sha256,
    ...(input.alt ? { alt: { en: input.alt } } : {}),
  });
  if (inserted) return { status: "created", id: inserted, ...result };

  // Someone inserted the same hash between our check and our insert: the image exists, which is the outcome we wanted.
  const raced = await deps.findIdBySha256(sha256);
  if (!raced) throw new Error("The media row could not be created and does not exist");
  return { status: "existing", id: raced, ...result };
}
