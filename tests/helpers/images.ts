import { randomBytes } from "node:crypto";
import sharp from "sharp";

/** Small synthetic images for tests. Nothing here is a real logo or photo. */

export async function flatWebp(width: number, height: number, options: { lossless?: boolean; alpha?: boolean } = {}): Promise<Uint8Array> {
  const channels = options.alpha ? 4 : 3;
  const pixels = Buffer.alloc(width * height * channels, 0x66);
  if (options.alpha) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0x80; // half transparent
  return new Uint8Array(await sharp(pixels, { raw: { width, height, channels } }).webp({ lossless: options.lossless ?? false, quality: 80 }).toBuffer());
}

/** Random pixels do not compress, so the file is big. Used to cross the size caps. */
export async function noiseWebp(width: number, height: number, lossless = false): Promise<Uint8Array> {
  const pixels = randomBytes(width * height * 3);
  return new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } }).webp({ lossless, quality: 95 }).toBuffer());
}

export async function noisePng(width: number, height: number): Promise<Uint8Array> {
  const pixels = randomBytes(width * height * 3);
  return new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

export async function flatPng(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#336699" } }).png().toBuffer());
}

export async function flatJpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#993366" } }).jpeg().toBuffer());
}

/**
 * A minimal WebP header (RIFF, then a lossless chunk with a signature and a 100 x 100 size) padded to `total` bytes. The image
 * reader only needs the header, so this is enough to test sizes and hashes without encoding anything. `seed` makes the bytes, and
 * so the hash, differ. Synchronous, unlike the sharp helpers above.
 */
export function webpBytes(total: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(Math.max(total, 32));
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, bytes.length - 8, true);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 8); // WEBP VP8L
  view.setUint32(16, bytes.length - 20, true);
  bytes[20] = 0x2f;
  view.setUint32(21, 99 | (99 << 14), true);
  for (let i = 25; i < bytes.length; i++) bytes[i] = (i * 31 + seed * 17 + (i >> 8)) & 0xff;
  return bytes;
}

/** An in-memory image store with the same contract as the Neon one: stored under the hash, never overwritten, no delete. */
export function createMemoryMediaStore() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    publicUrl: (sha256: string) => `https://storage.example.test/images/${sha256}.webp`,
    async get(sha256: string): Promise<Response | null> {
      const data = objects.get(sha256);
      return data ? new Response(data as BodyInit, { headers: { "content-type": "image/webp" } }) : null;
    },
    async put(sha256: string, data: Uint8Array): Promise<void> {
      if (!objects.has(sha256)) objects.set(sha256, data);
    },
  };
}
