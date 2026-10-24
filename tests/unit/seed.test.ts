import { describe, expect, it } from "vitest";
import { seedId } from "@/modules/seed/ids";
import { seedBundleSchema } from "@/modules/seed/schema";
import { buildSeedRows, imageFiles } from "@/modules/seed/service";
import { fixtureBundle, fixtureInput } from "../helpers/seed-fixture";

const parse = (input: unknown) => seedBundleSchema.safeParse(input);
const issuesOf = (input: unknown) => {
  const result = parse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};
const withUniversity = (patch: Record<string, unknown>) => {
  const input = fixtureInput() as { universities: Record<string, unknown>[] };
  input.universities[0] = { ...input.universities[0], ...patch };
  return input;
};

describe("seed files: the format (S1.7)", () => {
  it("accepts the fixture and defaults everything to draft", () => {
    const bundle = fixtureBundle();
    expect(bundle.universities).toHaveLength(3);
    expect(bundle.universities[0]?.programmes[1]?.status).toBe("draft");
    expect(bundle.faqs[1]?.status).toBe("draft");
    expect(parse({}).success).toBe(true);
    expect(parse({}).data).toEqual({ universities: [], faqs: [], process_steps: [], content_blocks: [] });
  });

  it("rejects unknown fields and bad values", () => {
    expect(issuesOf({ ...fixtureInput(), extra: 1 })).not.toEqual([]);
    expect(issuesOf(withUniversity({ slug: "Not A Slug" }))).not.toEqual([]);
    expect(issuesOf(withUniversity({ website_url: "not a url" }))).not.toEqual([]);
    expect(issuesOf(withUniversity({ status: "live" }))).not.toEqual([]);
    expect(issuesOf(withUniversity({ surprise: true }))).not.toEqual([]);
  });

  it("holds a confirmed fee to a real range (FR-2)", () => {
    const fee = (over: Record<string, unknown>) => withUniversity({ fees: [{ currency: "USD", period: "per year", data_confirmed: true, ...over }] });
    expect(issuesOf(fee({}))).not.toEqual([]);
    expect(issuesOf(fee({ amount_min: 0, amount_max: 100 }))).not.toEqual([]);
    expect(issuesOf(fee({ amount_min: 500, amount_max: 100 }))).not.toEqual([]);
    expect(issuesOf(fee({ amount_min: 500 }))).not.toEqual([]);
    expect(issuesOf(fee({ amount_min: 100, amount_max: 100 }))).toEqual([]);
    // An unconfirmed fee may be empty: it shows the WhatsApp call to action instead.
    expect(issuesOf(withUniversity({ fees: [{ currency: "USD", period: "per year" }] }))).toEqual([]);
  });

  it("holds a YouTube id to 11 characters (FR-3)", () => {
    const tour = (youtube_id: string) => withUniversity({ campus_experiences: [{ kind: "video", title: "T", youtube_id }] });
    expect(issuesOf(tour("dQw4w9WgXcQ"))).toEqual([]);
    for (const bad of ["short", "dQw4w9WgXcQx", "dQw4w9WgXc!"]) expect(issuesOf(tour(bad)), bad).not.toEqual([]);
  });

  it("rejects duplicates, so every row has an unambiguous key", () => {
    const input = fixtureInput() as { universities: Record<string, unknown>[]; faqs: Record<string, unknown>[] };
    expect(issuesOf({ ...input, universities: [input.universities[0], input.universities[0]] }).join()).toMatch(/Duplicate universities/);
    expect(issuesOf({ ...input, faqs: [input.faqs[0], input.faqs[0]] }).join()).toMatch(/Duplicate faqs/);
    expect(issuesOf(withUniversity({ programmes: [{ name: "A" }, { name: "A" }] })).join()).toMatch(/Duplicate programme/);
    expect(issuesOf(withUniversity({ fees: [{ currency: "USD", period: "p" }, { currency: "USD", period: "p" }] })).join()).toMatch(/Duplicate fee/);
  });

  it("a fee can only name a programme the university lists", () => {
    expect(issuesOf(withUniversity({ programmes: [{ name: "A" }], fees: [{ programme: "B", currency: "USD", period: "p" }] })).join()).toMatch(/does not list/);
  });

  it("content blocks need English text", () => {
    expect(issuesOf({ content_blocks: [{ key: "why.us", translations: { fr: "Non" } }] })).not.toEqual([]);
    expect(issuesOf({ content_blocks: [{ key: "why.us", translations: { en: "Yes" } }] })).toEqual([]);
  });
});

describe("seedId", () => {
  it("is deterministic, valid UUID v8 shaped, and different for different keys and kinds", async () => {
    const a = await seedId("university", "test-university-1");
    expect(await seedId("university", "test-university-1")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await seedId("university", "test-university-2")).not.toBe(a);
    expect(await seedId("programme", "test-university-1")).not.toBe(a);
  });
});

describe("buildSeedRows", () => {
  const media = (bundle = fixtureBundle()) => new Map([...imageFiles(bundle).keys()].map((file, i) => [file, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`]));

  it("finds every image once, with its kind", () => {
    const files = imageFiles(fixtureBundle());
    expect([...files.keys()].sort()).toEqual(["logos/university-1.png", "logos/university-2.png", "logos/university-3.png", "photos/shared-thumb.jpg"]);
    expect(files.get("logos/university-1.png")).toEqual({ kind: "logo", alt: "Test University 1 logo" });
    expect(files.get("photos/shared-thumb.jpg")?.kind).toBe("photo");
  });

  it("builds the same rows, with the same ids, every time", async () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const first = await buildSeedRows(fixtureBundle(), media(), now);
    const second = await buildSeedRows(fixtureBundle(), media(), now);
    expect(second).toEqual(first);
  });

  it("builds the expected number of rows and links programmes, fees and tours to their university", async () => {
    const rows = await buildSeedRows(fixtureBundle(), media());
    expect(rows.universities).toHaveLength(3);
    expect(rows.programmes).toHaveLength(6);
    expect(rows.feeStructures).toHaveLength(6);
    expect(rows.campusExperiences).toHaveLength(6);
    expect(rows.officialResources).toHaveLength(3);
    expect(rows.faqs).toHaveLength(2);
    expect(rows.processSteps).toHaveLength(3);
    expect(rows.contentBlocks).toHaveLength(1);
    const university1 = rows.universities[0];
    expect(rows.programmes.filter((p) => p.universityId === university1?.id)).toHaveLength(2);
    const programmeA = rows.programmes.find((p) => p.universityId === university1?.id && p.name === "Test Programme A");
    const confirmed = rows.feeStructures.find((f) => f.universityId === university1?.id && f.dataConfirmed);
    expect(confirmed?.programmeId).toBe(programmeA?.id);
    expect(rows.feeStructures.find((f) => f.universityId === university1?.id && !f.dataConfirmed)?.programmeId).toBeNull();
  });

  it("every id is unique", async () => {
    const rows = await buildSeedRows(fixtureBundle(), media());
    const ids = (Object.values(rows) as { id: string }[][]).flatMap((list) => list.map((row) => row.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draft rows have no publication time; published rows get it", async () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const rows = await buildSeedRows(fixtureBundle(), media(), now);
    expect(rows.universities[0]).toMatchObject({ status: "published", publishedAt: now });
    expect(rows.programmes.find((p) => p.name === "Test Programme B")).toMatchObject({ status: "draft", publishedAt: null });
    expect(rows.faqs[1]).toMatchObject({ status: "draft", publishedAt: null });
  });

  it("keeps money as exact decimal text and leaves a missing amount null, never zero", async () => {
    const rows = await buildSeedRows(fixtureBundle(), media());
    const confirmed = rows.feeStructures.find((f) => f.dataConfirmed);
    expect(confirmed).toMatchObject({ amountMin: "100000", amountMax: "150000", currency: "INR" });
    const unconfirmed = rows.feeStructures.find((f) => !f.dataConfirmed);
    expect(unconfirmed).toMatchObject({ amountMin: null, amountMax: null });
  });

  it("points logos and thumbnails at the imported media ids, and stops if one is missing", async () => {
    const ids = media();
    const rows = await buildSeedRows(fixtureBundle(), ids);
    expect(rows.universities[0]?.logoMediaId).toBe(ids.get("logos/university-1.png"));
    expect(rows.campusExperiences.find((c) => c.title === "Campus tour")?.thumbnailMediaId).toBe(ids.get("photos/shared-thumb.jpg"));
    await expect(buildSeedRows(fixtureBundle(), new Map())).rejects.toThrow(/No media asset was imported/);
  });
});
