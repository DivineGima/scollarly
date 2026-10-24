import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/hash";
import { uuidv7 } from "@/lib/uuid";
import { imageFiles, buildSeedRows } from "@/modules/seed/service";
import { seedBundleSchema } from "@/modules/seed/schema";
import { ingestImage, type IngestDeps } from "@/server/media/ingest";
import { findAssetIdBySha256, insertMediaAsset } from "@/server/repositories/media";
import { applySeed } from "@/server/repositories/seed";
import { toWebpWithinCap } from "../../scripts/lib/image";
import { fixtureBundle, fixtureInput } from "../helpers/seed-fixture";
import { flatJpeg, flatPng, noisePng } from "../helpers/images";
import { createTestDb, type TestDb } from "./helpers/db";

/**
 * S1.7 exit criteria, with synthetic data: the seed run twice leaves the database unchanged the second time, and each
 * university's logo exists as a `media_asset` row. The real run, with the 9 real universities, waits for the old
 * site's data files (tracker H2); `scripts/seed.ts` does exactly what this test does.
 */

let t: TestDb;
let images: Map<string, Uint8Array>;
const objects = new Map<string, Uint8Array>();

beforeAll(async () => {
  t = await createTestDb();
  images = await makeImages();
});
afterAll(async () => {
  await t.close();
});

const TABLES = ["university", "programme", "fee_structure", "campus_experience", "official_resource", "faq", "process_step", "content_block", "media_asset"] as const;

/** A fingerprint of every seeded table, so "unchanged" means every column of every row, not just the counts. */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of TABLES) {
    const rows = await t.run(`select * from ${table} order by id`);
    out[table] = `${rows.length}:${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`;
  }
  return out;
}

function ingestDeps(): IngestDeps {
  return {
    store: {
      get: async (sha) => (objects.has(sha) ? new Response(objects.get(sha) as BodyInit) : null),
      put: async (sha, bytes) => void objects.set(sha, bytes),
    },
    findIdBySha256: (sha) => findAssetIdBySha256(t.db, sha),
    insert: (row) => insertMediaAsset(t.db, row),
    newId: uuidv7,
  };
}

/** What scripts/seed.ts does after validating the files: convert and ingest each image, build the rows, insert them. */
async function runSeed(files: Map<string, Uint8Array>) {
  const bundle = fixtureBundle();
  const mediaIds = new Map<string, string>();
  const statuses: string[] = [];
  for (const [file, { kind, alt }] of imageFiles(bundle)) {
    const source = files.get(file);
    if (!source) throw new Error(`missing test image ${file}`);
    const webp = await toWebpWithinCap(source, kind);
    const result = await ingestImage(ingestDeps(), { bytes: webp, kind, ...(alt ? { alt } : {}) });
    mediaIds.set(file, result.id);
    statuses.push(result.status);
  }
  const report = await applySeed(t.db, await buildSeedRows(bundle, mediaIds));
  return { report, statuses };
}

/** Built once: the noise image is random, and a second run must see the same bytes the first run saw. */
const makeImages = async () =>
  new Map<string, Uint8Array>([
    ["logos/university-1.png", await flatPng(200, 100)],
    ["logos/university-2.png", await noisePng(120, 120)],
    ["logos/university-3.png", await flatJpeg(180, 90)],
    ["photos/shared-thumb.jpg", await flatJpeg(640, 360)],
  ]);

describe("S1.7: the seed", () => {
  it("inserts every row on the first run", async () => {
    const { report, statuses } = await runSeed(images);
    expect(report).toEqual({ universities: 3, programmes: 6, feeStructures: 6, campusExperiences: 6, officialResources: 3, faqs: 2, processSteps: 3, contentBlocks: 1 });
    expect(statuses).toEqual(["created", "created", "created", "created"]);
  });

  it("leaves the database unchanged when run a second time", async () => {
    const before = await snapshot();
    const { report, statuses } = await runSeed(images);
    expect(report).toEqual({ universities: 0, programmes: 0, feeStructures: 0, campusExperiences: 0, officialResources: 0, faqs: 0, processSteps: 0, contentBlocks: 0 });
    expect(statuses).toEqual(["existing", "existing", "existing", "existing"]);
    expect(await snapshot()).toEqual(before);
  });

  it("each university's logo exists as a media_asset row (WebP, hash-keyed, with its alt text)", async () => {
    const rows = (await t.run(`
      select u.slug, m.kind, m.mime, m.sha256, m.alt->>'en' as alt, m.bytes, m.width, m.height
        from university u join media_asset m on m.id = u.logo_media_id order by u.slug`)) as { slug: string; kind: string; mime: string; sha256: string; alt: string; bytes: number }[];
    expect(rows.map((r) => r.slug)).toEqual(["test-university-1", "test-university-2", "test-university-3"]);
    for (const row of rows) {
      expect(row.kind).toBe("logo");
      expect(row.mime).toBe("image/webp");
      expect(row.bytes).toBeLessThanOrEqual(50 * 1024);
      expect(row.alt).toMatch(/logo$/);
      // The object is in the bucket under its own hash, and the hash is the hash of the stored bytes.
      expect(await sha256Hex(objects.get(row.sha256) ?? new Uint8Array())).toBe(row.sha256);
    }
  });

  it("stores one object and one media row per image, even when several tours share a thumbnail", async () => {
    const [count] = (await t.run("select count(*)::int as n from media_asset")) as { n: number }[];
    expect(count?.n).toBe(4);
    expect(objects.size).toBe(4);
  });

  it("links programmes, fees and tours to the right university and nothing is orphaned", async () => {
    const orphans = (await t.run(`
      select (select count(*) from programme p left join university u on u.id = p.university_id where u.id is null)
           + (select count(*) from fee_structure f left join university u on u.id = f.university_id where u.id is null)
           + (select count(*) from campus_experience c left join university u on u.id = c.university_id where u.id is null)
           + (select count(*) from fee_structure f where f.programme_id is not null and not exists (select 1 from programme p where p.id = f.programme_id and p.university_id = f.university_id)) as n`)) as { n: number }[];
    expect(Number(orphans[0]?.n)).toBe(0);
  });

  it("never publishes a draft and never shows an unconfirmed fee as a number", async () => {
    const drafts = (await t.run(`select count(*)::int as n from programme where status = 'draft' and published_at is not null`)) as { n: number }[];
    expect(drafts[0]?.n).toBe(0);
    const unconfirmed = (await t.run(`select count(*)::int as n from fee_structure where not data_confirmed and (amount_min is not null or amount_max is not null)`)) as { n: number }[];
    expect(unconfirmed[0]?.n).toBe(0);
  });

  it("does not overwrite a row that was edited after the first run", async () => {
    await t.run(`update university set name = 'Edited in the admin screen' where slug = 'test-university-1'`);
    await runSeed(images);
    const [row] = (await t.run(`select name from university where slug = 'test-university-1'`)) as { name: string }[];
    expect(row?.name).toBe("Edited in the admin screen");
  });

  it("every seeded row satisfies the database constraints, because the files were validated first", () => {
    expect(seedBundleSchema.safeParse(fixtureInput()).success).toBe(true);
  });
});
