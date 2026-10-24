#!/usr/bin/env node
/**
 * S0.5: creates ~300 KB WebP images, uploads them to the Neon Object Storage bucket `images` (public-read) under their
 * own hash, and records their metadata in `media_asset`, so `/media/<sha256>.webp` can be served and measured.
 * 300 KB is the proposed photo cap (FR-18). The first image is used for the cache-hit scenario, the others for first-request
 * (cache miss) scenarios, so with --count 10 one run gives 1 hit image and 9 miss images.
 *
 *   node scripts/seed-phase0-image.mjs --out-only          only write scripts/.generated/phase0-300kb.webp
 *   node scripts/seed-phase0-image.mjs [--count 10]        also upload and insert (run after migrations)
 *
 * Environment for the upload: DATABASE_URL (owner, direct), NEON_STORAGE_ENDPOINT, NEON_STORAGE_REGION,
 * NEON_STORAGE_ACCESS_KEY_ID, NEON_STORAGE_SECRET_ACCESS_KEY. Nothing is printed except hashes and sizes.
 * `sharp` and `aws4fetch` are used here only through the build; the Worker has its own storage code (src/server/media).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { AwsClient } from "aws4fetch";
import pg from "pg";
import sharp from "sharp";

const TARGET = 300 * 1024;
const outOnly = process.argv.includes("--out-only");
const countIndex = process.argv.indexOf("--count");
const count = countIndex > 0 ? Number.parseInt(process.argv[countIndex + 1] ?? "1", 10) : 1;
const BUCKET = "images";

// Pseudo-random but deterministic pixels, so the same file (and hash) is produced every run for the same variant.
function noise(width, height, variant) {
  const data = Buffer.alloc(width * height * 3);
  let s = 123456789 + variant;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = (s >>> 24) & 0xff;
  }
  return data;
}

async function build(variant) {
  // Find the largest quality that stays at or under the target for a 1200x800 image.
  const raw = { raw: { width: 1200, height: 800, channels: 3 } };
  const pixels = noise(1200, 800, variant);
  let best = null;
  for (let quality = 4; quality <= 40; quality += 1) {
    const buf = await sharp(pixels, raw).webp({ quality, effort: 2 }).toBuffer();
    if (buf.length > TARGET * 1.02) break;
    best = { buf, quality };
  }
  if (!best) throw new Error("could not build an image near the target size");
  return { ...best, width: 1200, height: 800 };
}

const images = [];
for (let variant = 0; variant < Math.max(1, count); variant++) {
  const { buf, quality, width, height } = await build(Number(process.env.SEED_VARIANT ?? 0) + variant);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  images.push({ buf, width, height, sha256 });
  console.log(`Image ${variant}: ${(buf.length / 1024).toFixed(1)} KB WebP (quality ${quality}, ${width}x${height}) sha256: ${sha256}`);
}
mkdirSync("scripts/.generated", { recursive: true });
writeFileSync("scripts/.generated/phase0-300kb.webp", images[0].buf);
writeFileSync("scripts/.generated/phase0-images.json", JSON.stringify({ shas: images.map((i) => i.sha256) }, null, 2));
console.log(`URL path: /media/${images[0].sha256}.webp`);

if (outOnly) process.exit(0);

const need = ["DATABASE_URL", "NEON_STORAGE_ENDPOINT", "NEON_STORAGE_REGION", "NEON_STORAGE_ACCESS_KEY_ID", "NEON_STORAGE_SECRET_ACCESS_KEY"];
const missing = need.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Not uploaded. Missing: ${missing.join(", ")}. Use --out-only to skip the upload.`);
  process.exit(1);
}

const endpoint = process.env.NEON_STORAGE_ENDPOINT.replace(/\/+$/, "");
const signer = new AwsClient({
  accessKeyId: process.env.NEON_STORAGE_ACCESS_KEY_ID,
  secretAccessKey: process.env.NEON_STORAGE_SECRET_ACCESS_KEY,
  service: "s3",
  region: process.env.NEON_STORAGE_REGION,
});
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const { buf, width, height, sha256 } of images) {
    const url = `${endpoint}/${BUCKET}/${sha256}.webp`;
    const put = await signer.fetch(url, { method: "PUT", body: buf, headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" } });
    if (!put.ok) throw new Error(`Upload failed for ${sha256}: HTTP ${put.status}`);
    // A public-read bucket must serve the object with no credential at all.
    const read = await fetch(url);
    const bytes = new Uint8Array(await read.arrayBuffer());
    if (!read.ok || createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error(`Public read failed or differs for ${sha256}: HTTP ${read.status}`);
    const inserted = await client.query(
      `insert into media_asset (id, kind, width, height, bytes, mime, sha256) values ($1, 'photo', $2, $3, $4, 'image/webp', $5) on conflict (sha256) do nothing returning id`,
      [randomUUID(), width, height, buf.length, sha256],
    );
    console.log(`${sha256.slice(0, 12)}…: uploaded, public read verified, ${inserted.rowCount === 0 ? "metadata already present" : "metadata inserted"}.`);
  }
} finally {
  await client.end();
}
