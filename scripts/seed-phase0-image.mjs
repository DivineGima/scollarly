#!/usr/bin/env node
/**
 * S0.5: creates one ~300 KB WebP and stores it in `media_asset` + `media_blob`, so `/media/<sha256>.webp`
 * can be served and measured. 300 KB is the proposed photo cap (FR-18).
 *
 *   node scripts/seed-phase0-image.mjs --out-only          only write scripts/.generated/phase0-300kb.webp
 *   DATABASE_URL=postgres://... node scripts/seed-phase0-image.mjs     also insert it (run after migrations)
 *
 * `sharp` is a dev dependency used here only; it is never bundled into the Worker.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import sharp from "sharp";

const TARGET = 300 * 1024;
const outOnly = process.argv.includes("--out-only");

// Pseudo-random but deterministic pixels, so the same file (and hash) is produced every run.
function noise(width, height) {
  const data = Buffer.alloc(width * height * 3);
  let s = 123456789;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = (s >>> 24) & 0xff;
  }
  return data;
}

async function build() {
  // Find the largest quality that stays at or under the target for a 1200x800 image.
  const raw = { raw: { width: 1200, height: 800, channels: 3 } };
  const pixels = noise(1200, 800);
  let best = null;
  for (let quality = 4; quality <= 40; quality += 1) {
    const buf = await sharp(pixels, raw).webp({ quality, effort: 2 }).toBuffer();
    if (buf.length > TARGET * 1.02) break;
    best = { buf, quality };
  }
  if (!best) throw new Error("could not build an image near the target size");
  return { ...best, width: 1200, height: 800 };
}

const { buf, quality, width, height } = await build();
const sha256 = createHash("sha256").update(buf).digest("hex");
mkdirSync("scripts/.generated", { recursive: true });
writeFileSync("scripts/.generated/phase0-300kb.webp", buf);
console.log(`Image: ${(buf.length / 1024).toFixed(1)} KB WebP (quality ${quality}, ${width}x${height})`);
console.log(`sha256: ${sha256}`);
console.log(`URL path: /media/${sha256}.webp`);

if (outOnly) process.exit(0);
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set, so nothing was inserted. Use --out-only to skip the database.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("begin");
  const id = randomUUID();
  const inserted = await client.query(
    `insert into media_asset (id, kind, width, height, bytes, mime, sha256) values ($1, 'photo', $2, $3, $4, 'image/webp', $5) on conflict (sha256) do nothing returning id`,
    [id, width, height, buf.length, sha256],
  );
  if (inserted.rowCount === 0) console.log("Already stored (same hash). Nothing changed.");
  else {
    await client.query("insert into media_blob (media_id, data) values ($1, $2)", [id, buf]);
    console.log("Stored in media_asset and media_blob.");
  }
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
