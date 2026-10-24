import sharp, { type Metadata, type Sharp } from "sharp";
import { IMAGE_CAPS, type ImageKind } from "../../src/server/media/ingest";

/**
 * Makes an image file fit the rules of FR-18 before it is ingested: WebP, within the byte cap of its kind. Node only
 * (it uses sharp), which is why it lives in `scripts/` and not in the Worker bundle. The browser does the same job for
 * uploads in Stage 6 (S6.3).
 *
 * Longest side limits are this script's choice, not the architecture's: 512 px for a logo, 1600 px for a photo.
 */

const MAX_SIDE: Record<ImageKind, number> = { logo: 512, photo: 1600, blog: 1600, testimonial: 1600, other: 1600 };
const QUALITIES = [85, 78, 70, 62, 54, 46, 38, 30];
const SHRINK = [1, 0.8, 0.64, 0.5];

export class ImageConvertError extends Error {}

function looksLikeSvg(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).toString("utf8").toLowerCase().includes("<svg");
}

/** WebP bytes no larger than the cap for `kind`. Throws `ImageConvertError` for SVG, for unreadable input, or when no setting fits. */
export async function toWebpWithinCap(input: Uint8Array, kind: ImageKind): Promise<Uint8Array> {
  if (looksLikeSvg(input)) throw new ImageConvertError("SVG is not accepted (FR-18). Export it as PNG or WebP first.");
  const cap = IMAGE_CAPS[kind];

  let source: Sharp;
  let metadata: Metadata;
  try {
    source = sharp(input, { failOn: "error" }).rotate(); // apply EXIF orientation, then drop it
    metadata = await sharp(input).metadata();
  } catch {
    throw new ImageConvertError("The file is not an image sharp can read.");
  }
  const longest = Math.max(metadata.width ?? 1, metadata.height ?? 1);
  const limit = Math.min(longest, MAX_SIDE[kind]);

  for (const scale of SHRINK) {
    const side = Math.max(16, Math.round(limit * scale));
    for (const quality of QUALITIES) {
      const out = await source.clone().resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 4 }).toBuffer();
      if (out.byteLength <= cap) return new Uint8Array(out);
    }
  }
  throw new ImageConvertError(`Could not bring the image under ${cap} bytes.`);
}
