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
