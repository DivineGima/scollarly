/**
 * S1.7: seed the database from the seed files and import their images.
 *
 *   npx tsx scripts/seed.ts --dir data/seed --dry-run     check the files and the images, touch nothing
 *   npx tsx scripts/seed.ts --dir data/seed               import the images, then insert the rows
 *
 * Environment for a real run (see docs/stage-1-runbook.md; nothing here is read from a file in the repository):
 *   MIGRATION_DATABASE_URL            the OWNER role's connection string, as the migrations use
 *   NEON_STORAGE_ENDPOINT, NEON_STORAGE_REGION, NEON_STORAGE_ACCESS_KEY_ID, NEON_STORAGE_SECRET_ACCESS_KEY
 *
 * Safe to run twice: rows have deterministic ids and are inserted with ON CONFLICT DO NOTHING, and an image is identified
 * by its content hash, so the second run inserts nothing and uploads nothing.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { uuidv7 } from "../src/lib/uuid";
import { SEED_FILES, seedBundleSchema } from "../src/modules/seed/schema";
import { buildSeedRows, imageFiles } from "../src/modules/seed/service";
import { createHttpDb } from "../src/server/db/client";
import { ingestImage, parseWebp } from "../src/server/media/ingest";
import { createMediaStore } from "../src/server/media/store";
import { findAssetIdBySha256, insertMediaAsset } from "../src/server/repositories/media";
import { applySeed } from "../src/server/repositories/seed";
import { toWebpWithinCap } from "./lib/image";

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function fail(message: string): never {
  console.error(`seed: ${message}`);
  process.exit(1);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    return fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const dir = resolve(argValue("--dir") ?? "data/seed");
  const dryRun = process.argv.includes("--dry-run");

  const input: Record<string, unknown> = {};
  let found = 0;
  for (const [key, file] of Object.entries(SEED_FILES)) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    input[key] = await readJson(path);
    found++;
  }
  if (found === 0) {
    fail(`no seed files in ${dir}. The old site's data (universities, programmes, fees, FAQs, process steps, copy, logos and images) is supplied by the owner (tracker H2); do not invent it.`);
  }

  const parsed = seedBundleSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    fail("the seed files are not valid.");
  }
  const bundle = parsed.data;
  const images = imageFiles(bundle);
  const missing = [...images.keys()].filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) fail(`image files not found in ${dir}: ${missing.join(", ")}`);

  console.log(
    `seed: ${bundle.universities.length} universities, ${bundle.universities.reduce((n, u) => n + u.programmes.length, 0)} programmes, ` +
      `${bundle.universities.reduce((n, u) => n + u.fees.length, 0)} fees, ${bundle.faqs.length} FAQs, ${bundle.process_steps.length} process steps, ` +
      `${bundle.content_blocks.length} copy blocks, ${images.size} images`,
  );
  if (dryRun) {
    // Convert every image too, so a file that cannot meet the caps is found now and not halfway through a real run.
    for (const [file, { kind }] of images) {
      const converted = await toWebpWithinCap(new Uint8Array(await readFile(join(dir, file))), kind);
      const size = parseWebp(converted);
      console.log(`  ${file}: ${kind}, ${converted.byteLength} bytes, ${size?.width}x${size?.height}`);
    }
    console.log("seed: dry run, nothing was written.");
    return;
  }

  const databaseUrl = process.env.MIGRATION_DATABASE_URL;
  const { NEON_STORAGE_ENDPOINT: endpoint, NEON_STORAGE_REGION: region, NEON_STORAGE_ACCESS_KEY_ID: accessKeyId, NEON_STORAGE_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!databaseUrl) fail("MIGRATION_DATABASE_URL is not set.");
  if (images.size > 0 && (!endpoint || !region || !accessKeyId || !secretAccessKey)) fail("the NEON_STORAGE_* variables are not set.");

  const db = createHttpDb(databaseUrl);
  const store = createMediaStore({ endpoint: endpoint ?? "", region: region ?? "", accessKeyId: accessKeyId ?? "", secretAccessKey: secretAccessKey ?? "" });
  const deps = {
    store,
    findIdBySha256: (sha256: string) => findAssetIdBySha256(db, sha256),
    insert: (row: Parameters<typeof insertMediaAsset>[1]) => insertMediaAsset(db, row),
    newId: uuidv7,
  };

  const mediaIds = new Map<string, string>();
  for (const [file, { kind, alt }] of images) {
    const webp = await toWebpWithinCap(new Uint8Array(await readFile(join(dir, file))), kind);
    const result = await ingestImage(deps, { bytes: webp, kind, ...(alt ? { alt } : {}) });
    mediaIds.set(file, result.id);
    console.log(`  image ${file}: ${result.status} (${result.bytes} bytes, ${result.width}x${result.height})`);
  }

  const report = await applySeed(db, await buildSeedRows(bundle, mediaIds));
  console.log("seed: rows inserted this run (a second run reports zeros):");
  for (const [table, count] of Object.entries(report)) console.log(`  ${table}: ${count}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
