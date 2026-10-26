import { IMAGE_CAPS, IMAGE_MAX_SIDE, type ImageKind } from "@/lib/image-caps";

/**
 * Preparing a picture in the browser before it is uploaded (architecture 10.5, 16 B6 step 4; S6.3). A phone photo is several
 * megabytes; the site allows 300 KB. So the picture is shrunk here, converted to WebP and tried at falling quality until it fits,
 * and the person sees the result and its size before anything is sent. The server checks size, file signature and kind again.
 *
 * A photo of a document (an offer letter) can have areas pixelated first. Pixelating throws the pixels away for good, unlike a light
 * blur, which can sometimes be undone. The areas are in fractions of the picture (0 to 1), so they do not depend on the size.
 */

export type PrepareErrorCode = "NOT_IMAGE" | "SVG" | "SOURCE_TOO_BIG" | "DECODE_FAILED" | "WEBP_UNSUPPORTED" | "TOO_LARGE";

export class PrepareError extends Error {
  constructor(public readonly code: PrepareErrorCode) {
    super(code);
    this.name = "PrepareError";
  }
}

/** A picture straight from a phone can be 12 MB or more; beyond this the browser may run out of memory decoding it. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** A rectangle to pixelate, in fractions of the picture. */
export interface Redaction {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pure: whether a chosen file can be used at all. SVG is refused (it can carry script); everything else must be a raster picture. */
export function classifyFile(file: { name: string; type: string; size: number }): PrepareErrorCode | null {
  if (file.type === "image/svg+xml" || /\.svgz?$/i.test(file.name)) return "SVG";
  if (!file.type.startsWith("image/")) return "NOT_IMAGE";
  if (file.size > MAX_SOURCE_BYTES) return "SOURCE_TOO_BIG";
  return null;
}

/** Pure: the size that fits `maxSide` on the longer side, keeping the shape. A picture already small enough keeps its size. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Pure: the (quality, size) pairs tried in order, from nicest to smallest. */
export function attempts(maxSide: number): { quality: number; maxSide: number }[] {
  const out: { quality: number; maxSide: number }[] = [];
  for (const factor of [1, 0.8, 0.64, 0.5, 0.4, 0.3]) {
    const side = Math.max(64, Math.round(maxSide * factor));
    for (const quality of [0.85, 0.7, 0.55, 0.4]) out.push({ quality, maxSide: side });
  }
  return out;
}

/** Pure: clamps a rectangle dragged on the preview to the picture and drops one too small to matter. */
export function normaliseRedaction(r: Redaction): Redaction | null {
  const x = Math.min(Math.max(Math.min(r.x, r.x + r.w), 0), 1);
  const y = Math.min(Math.max(Math.min(r.y, r.y + r.h), 0), 1);
  const x2 = Math.min(Math.max(Math.max(r.x, r.x + r.w), 0), 1);
  const y2 = Math.min(Math.max(Math.max(r.y, r.y + r.h), 0), 1);
  const w = x2 - x;
  const h = y2 - y;
  return w < 0.02 || h < 0.02 ? null : { x, y, w, h };
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function pixelate(ctx: Canvas2D, source: CanvasImageSource, width: number, height: number, area: Redaction): void {
  const x = Math.round(area.x * width);
  const y = Math.round(area.y * height);
  const w = Math.max(1, Math.round(area.w * width));
  const h = Math.max(1, Math.round(area.h * height));
  // Each block is about a fortieth of the picture's longer side, so the text inside is unreadable at any size.
  const block = Math.max(6, Math.round(Math.max(width, height) / 40));
  const small = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(Math.max(1, Math.ceil(w / block)), Math.max(1, Math.ceil(h / block))) : Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.ceil(w / block)), height: Math.max(1, Math.ceil(h / block)) });
  const sctx = small.getContext("2d") as Canvas2D | null;
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(source, x, y, w, h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
  ctx.restore();
}

interface Drawn {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
}

function draw(bitmap: ImageBitmap, maxSide: number, redactions: readonly Redaction[]): Drawn | null {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d") as Canvas2D | null;
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  for (const area of redactions) pixelate(ctx, canvas as CanvasImageSource, width, height, area);
  return { canvas, width, height };
}

async function toWebp(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/webp", quality });
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
}

/** Decodes, shrinks and converts one picture to WebP under the cap for `kind`. Throws a `PrepareError` with a code the screen can explain. */
export async function prepareImage(file: File, kind: ImageKind, redactions: readonly Redaction[] = []): Promise<PreparedImage> {
  const refused = classifyFile(file);
  if (refused) throw new PrepareError(refused);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PrepareError("DECODE_FAILED");
  }
  try {
    const cap = IMAGE_CAPS[kind];
    let lastSide = 0;
    let drawn: Drawn | null = null;
    for (const attempt of attempts(IMAGE_MAX_SIDE[kind])) {
      // Draw again only when the size changes; the quality loop reuses the canvas.
      if (!drawn || attempt.maxSide !== lastSide) {
        drawn = draw(bitmap, attempt.maxSide, redactions);
        lastSide = attempt.maxSide;
      }
      if (!drawn) throw new PrepareError("DECODE_FAILED");
      const blob = await toWebp(drawn.canvas, attempt.quality);
      // A browser that cannot write WebP answers with a PNG instead.
      if (!blob || blob.type !== "image/webp") throw new PrepareError("WEBP_UNSUPPORTED");
      if (blob.size <= cap) return { blob, width: drawn.width, height: drawn.height, bytes: blob.size };
    }
    throw new PrepareError("TOO_LARGE");
  } finally {
    bitmap.close();
  }
}
