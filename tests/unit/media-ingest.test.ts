import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/hash";
import { IMAGE_CAPS, ingestImage, IngestError, type IngestDeps, parseWebp, type NewMediaRow } from "@/server/media/ingest";
import { flatJpeg, flatPng, flatWebp, noisePng, noiseWebp } from "../helpers/images";
import { ImageConvertError, toWebpWithinCap } from "../../scripts/lib/image";

describe("parseWebp reads the size from the header of all three WebP kinds", () => {
  it("lossy (VP8)", async () => {
    expect(parseWebp(await flatWebp(120, 80))).toEqual({ width: 120, height: 80 });
  });

  it("lossless (VP8L)", async () => {
    expect(parseWebp(await flatWebp(64, 32, { lossless: true }))).toEqual({ width: 64, height: 32 });
  });

  it("extended with transparency (VP8X)", async () => {
    const bytes = await flatWebp(50, 40, { alpha: true });
    expect(Buffer.from(bytes.subarray(12, 16)).toString("ascii")).toBe("VP8X");
    expect(parseWebp(bytes)).toEqual({ width: 50, height: 40 });
  });

  it("a one-pixel and a large image", async () => {
    expect(parseWebp(await flatWebp(1, 1))).toEqual({ width: 1, height: 1 });
    expect(parseWebp(await flatWebp(3000, 2000))).toEqual({ width: 3000, height: 2000 });
  });

  it("refuses PNG, JPEG, text, empty input and random bytes", async () => {
    for (const bytes of [await flatPng(20, 20), await flatJpeg(20, 20), new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), new Uint8Array(), new Uint8Array(200).fill(7)]) {
      expect(parseWebp(bytes)).toBeNull();
    }
  });

  it("refuses a truncated file and a wrong container", async () => {
    const good = await flatWebp(100, 100);
    expect(parseWebp(good.subarray(0, good.length - 5))).toBeNull();
    expect(parseWebp(good.subarray(0, 20))).toBeNull();
    const notRiff = good.slice();
    notRiff[0] = 0x58; // "XIFF"
    expect(parseWebp(notRiff)).toBeNull();
    const notWebp = good.slice();
    notWebp[8] = 0x41; // "AEBP"
    expect(parseWebp(notWebp)).toBeNull();
  });
});

function fakeDeps(overrides: Partial<IngestDeps> = {}) {
  const rows = new Map<string, string>();
  const objects = new Set<string>();
  let counter = 0;
  const deps: IngestDeps = {
    store: {
      get: vi.fn(async (sha: string) => (objects.has(sha) ? new Response("x") : null)),
      put: vi.fn(async (sha: string) => void objects.add(sha)),
    },
    findIdBySha256: vi.fn(async (sha: string) => rows.get(sha) ?? null),
    insert: vi.fn(async (row: NewMediaRow) => {
      if (rows.has(row.sha256)) return null;
      rows.set(row.sha256, row.id);
      return row.id;
    }),
    newId: () => `id-${++counter}`,
    ...overrides,
  };
  return { deps, rows, objects };
}

describe("ingestImage (FR-18)", () => {
  it("stores the object under its hash, then the row, and reports the size", async () => {
    const { deps, rows, objects } = fakeDeps();
    const bytes = await flatWebp(100, 60);
    const result = await ingestImage(deps, { bytes, kind: "photo", alt: "A campus" });
    expect(result).toMatchObject({ status: "created", id: "id-1", width: 100, height: 60, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) });
    expect(objects.has(result.sha256)).toBe(true);
    expect(rows.get(result.sha256)).toBe("id-1");
    expect(deps.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "photo", alt: { en: "A campus" } }));
  });

  it("the same bytes a second time create nothing and upload nothing (hash dedupe)", async () => {
    const { deps } = fakeDeps();
    const bytes = await flatWebp(100, 60);
    const first = await ingestImage(deps, { bytes, kind: "photo" });
    const second = await ingestImage(deps, { bytes, kind: "logo" });
    expect(second).toMatchObject({ status: "existing", id: first.id });
    expect(deps.store.put).toHaveBeenCalledTimes(1);
    expect(deps.insert).toHaveBeenCalledTimes(1);
  });

  it("never overwrites an object that is already in the bucket (a previous run stopped before the row)", async () => {
    const { deps, objects } = fakeDeps();
    const bytes = await flatWebp(30, 30);
    objects.add(await sha256Hex(bytes));
    const result = await ingestImage(deps, { bytes, kind: "photo" });
    expect(result.status).toBe("created");
    expect(deps.store.put).not.toHaveBeenCalled();
  });

  it("writes the object before the row, so a row never points at a missing object", async () => {
    const order: string[] = [];
    const { deps } = fakeDeps({ insert: vi.fn(async (row: NewMediaRow) => (order.push("insert"), row.id)) });
    deps.store.put = vi.fn(async () => void order.push("put"));
    await ingestImage(deps, { bytes: await flatWebp(20, 20), kind: "photo" });
    expect(order).toEqual(["put", "insert"]);
  });

  it("writes no row when the upload fails", async () => {
    const { deps } = fakeDeps();
    deps.store.put = vi.fn(async () => {
      throw new Error("storage down");
    });
    await expect(ingestImage(deps, { bytes: await flatWebp(20, 20), kind: "photo" })).rejects.toThrow(/storage down/);
    expect(deps.insert).not.toHaveBeenCalled();
  });

  it("treats a lost race on the unique hash as success", async () => {
    const { deps, rows } = fakeDeps();
    const bytes = await flatWebp(20, 20);
    const sha = await sha256Hex(bytes);
    deps.findIdBySha256 = vi.fn().mockResolvedValueOnce(null).mockImplementation(async () => rows.get(sha) ?? null);
    deps.insert = vi.fn(async () => {
      rows.set(sha, "winner");
      return null;
    });
    expect(await ingestImage(deps, { bytes, kind: "photo" })).toMatchObject({ status: "existing", id: "winner" });
  });

  it("refuses empty input, non-WebP files and SVG, and touches neither storage nor the database", async () => {
    const { deps } = fakeDeps();
    await expect(ingestImage(deps, { bytes: new Uint8Array(), kind: "photo" })).rejects.toMatchObject({ code: "EMPTY" });
    await expect(ingestImage(deps, { bytes: await flatPng(20, 20), kind: "photo" })).rejects.toMatchObject({ code: "NOT_WEBP" });
    await expect(ingestImage(deps, { bytes: new TextEncoder().encode("<svg/>"), kind: "logo" })).rejects.toBeInstanceOf(IngestError);
    expect(deps.store.put).not.toHaveBeenCalled();
    expect(deps.insert).not.toHaveBeenCalled();
  });

  it("holds a logo to 50 KB and a photo to 300 KB", async () => {
    expect(IMAGE_CAPS.logo).toBe(50 * 1024);
    expect(IMAGE_CAPS.photo).toBe(300 * 1024);
    const { deps } = fakeDeps();
    const big = await noiseWebp(250, 250); // random pixels: over 50 KB but under 300 KB
    expect(big.byteLength).toBeGreaterThan(IMAGE_CAPS.logo);
    await expect(ingestImage(deps, { bytes: big, kind: "logo" })).rejects.toMatchObject({ code: "TOO_LARGE" });
    const huge = await noiseWebp(1000, 700, true);
    expect(huge.byteLength).toBeGreaterThan(IMAGE_CAPS.photo);
    await expect(ingestImage(deps, { bytes: huge, kind: "photo" })).rejects.toMatchObject({ code: "TOO_LARGE" });
    // The same image is fine as a photo.
    expect(big.byteLength).toBeLessThan(IMAGE_CAPS.photo);
    await expect(ingestImage(deps, { bytes: big, kind: "photo" })).resolves.toMatchObject({ status: "created" });
  });
});

describe("toWebpWithinCap (the import script's converter)", () => {
  it("turns PNG and JPEG into WebP", async () => {
    for (const input of [await flatPng(300, 200), await flatJpeg(300, 200)]) {
      const out = await toWebpWithinCap(input, "photo");
      expect(parseWebp(out)).toEqual({ width: 300, height: 200 });
    }
  });

  it("shrinks a large noisy image under the cap of its kind, and never enlarges", { timeout: 120_000 }, async () => {
    const photo = await toWebpWithinCap(await noiseWebp(900, 700), "photo");
    expect(photo.byteLength).toBeLessThanOrEqual(IMAGE_CAPS.photo);
    const logo = await toWebpWithinCap(await noiseWebp(600, 600), "logo");
    expect(logo.byteLength).toBeLessThanOrEqual(IMAGE_CAPS.logo);
    const size = parseWebp(logo);
    expect(Math.max(size?.width ?? 0, size?.height ?? 0)).toBeLessThanOrEqual(512);
    const small = parseWebp(await toWebpWithinCap(await flatPng(40, 30), "photo"));
    expect(small).toEqual({ width: 40, height: 30 });
  });

  it("refuses SVG and unreadable files", async () => {
    await expect(toWebpWithinCap(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), "logo")).rejects.toBeInstanceOf(ImageConvertError);
    await expect(toWebpWithinCap(new TextEncoder().encode("<?xml version='1.0'?><svg></svg>"), "logo")).rejects.toThrow(/SVG/);
    await expect(toWebpWithinCap(new Uint8Array(100).fill(1), "photo")).rejects.toBeInstanceOf(ImageConvertError);
    await expect(toWebpWithinCap(new Uint8Array(), "photo")).rejects.toBeInstanceOf(ImageConvertError);
  });

  it("its output passes ingestImage", async () => {
    const { deps } = fakeDeps();
    const out = await toWebpWithinCap(await noisePng(500, 500), "logo");
    await expect(ingestImage(deps, { bytes: out, kind: "logo" })).resolves.toMatchObject({ status: "created" });
  });
});
