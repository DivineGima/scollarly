import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

/**
 * S13.7 (architecture 21.12, ADR-048; FR-30): the logo exists as a vector, the icon set and the installed app's launch screen use the white
 * logo on the owner's dark neon blue (`#1F3BFF`, R4), and the website keeps the black logo on white. The icons are made by
 * `scripts/make-icons.mjs` and committed; these tests read the committed files, so a stale or wrong icon fails here.
 */

const BLUE = { r: 0x1f, g: 0x3b, b: 0xff };
const svg = (path: string) => readFileSync(path, "utf8");
const pathOf = (text: string) => /<path[^>]* d="([^"]+)"/.exec(text)?.[1] ?? "";

describe("the logo vector", () => {
  const black = svg("public/brand/logo.svg");
  const white = svg("public/brand/logo-white.svg");

  it("is one path in black for the website and the same path in white for dark backgrounds", () => {
    expect(black).toContain('fill="#000000"');
    expect(white).toContain('fill="#ffffff"');
    expect(pathOf(black)).not.toBe("");
    expect(pathOf(black)).toBe(pathOf(white));
    expect(/viewBox="([^"]+)"/.exec(black)?.[1]).toBe(/viewBox="([^"]+)"/.exec(white)?.[1]);
  });

  it("is small and self-contained: no script, no animation, no outside address, no embedded picture, and a name for screen readers", () => {
    for (const text of [black, white]) {
      expect(text.length).toBeLessThan(2000);
      expect(text).not.toMatch(/<script|<style|animate|<image|data:|href=/i);
      expect(text.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\//);
      expect(text).toContain('aria-label="Scollarly"');
    }
  });

  it("draws the mark inside its own box, with some room around it", async () => {
    const { data, info } = await sharp(Buffer.from(black), { density: 144 }).flatten({ background: "#fff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const dark = (x: number, y: number) => (data[y * info.width + x] ?? 255) < 128;
    let touches = false;
    for (let i = 0; i < info.width; i += 1) if (dark(i, 0) || dark(i, info.height - 1)) touches = true;
    for (let i = 0; i < info.height; i += 1) if (dark(0, i) || dark(info.width - 1, i)) touches = true;
    expect(touches).toBe(false);
  });
});

describe("the icon set", () => {
  const pixel = async (path: string, x: number, y: number) => {
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (y * info.width + x) * info.channels;
    return { r: data[at] ?? 0, g: data[at + 1] ?? 0, b: data[at + 2] ?? 0 };
  };

  for (const [path, size] of [
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/maskable-512.png", 512],
    ["public/icons/apple-touch-icon.png", 180],
  ] as const) {
    it(`${path} is ${size} by ${size}, full-bleed brand blue, with the white mark in the middle`, async () => {
      const meta = await sharp(path).metadata();
      expect([meta.width, meta.height]).toEqual([size, size]);
      const near = (p: { r: number; g: number; b: number }, q: { r: number; g: number; b: number }) => Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b) < 12;
      expect(near(await pixel(path, 1, 1), BLUE)).toBe(true);
      expect(near(await pixel(path, size - 2, size - 2), BLUE)).toBe(true);
      const middle = await pixel(path, Math.round(size / 2), Math.round(size / 2));
      expect(middle.r > 240 && middle.g > 240 && middle.b > 240).toBe(true);
    });
  }

  it("keeps the whole mark inside the maskable icon's safe zone (the inner 80%)", async () => {
    const { data, info } = await sharp("public/icons/maskable-512.png").raw().toBuffer({ resolveWithObject: true });
    const margin = Math.round(info.width * 0.1);
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (x >= margin && x < info.width - margin && y >= margin && y < info.height - margin) continue;
        const at = (y * info.width + x) * info.channels;
        if ((data[at] ?? 0) > 100) throw new Error(`a light pixel at ${x},${y} is outside the safe zone`);
      }
    }
  });

  it("has a favicon.ico holding 16, 32 and 48 pixel images", () => {
    const ico = readFileSync("public/favicon.ico");
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    expect([0, 1, 2].map((i) => ico.readUInt8(6 + 16 * i))).toEqual([16, 32, 48]);
    for (let i = 0; i < 3; i += 1) {
      const size = ico.readUInt32LE(6 + 16 * i + 8);
      const offset = ico.readUInt32LE(6 + 16 * i + 12);
      expect(ico.subarray(offset, offset + 4).toString("hex")).toBe("89504e47");
      expect(offset + size).toBeLessThanOrEqual(ico.length);
    }
  });

  it("has a tab icon that is the white mark on a rounded brand-blue square", () => {
    const icon = svg("src/app/icon.svg");
    expect(icon).toContain('fill="#1F3BFF"');
    expect(icon).toContain('fill="#fff"');
    expect(pathOf(icon)).toBe(pathOf(svg("public/brand/logo-white.svg")));
  });
});

describe("the web app manifest", () => {
  const m = manifest();

  it("launches on the brand blue, which is the installed app's launch screen (no script, no delay)", () => {
    expect(m.background_color).toBe("#1F3BFF");
    expect(m.theme_color).toBe("#1F3BFF");
  });

  it("lists icons that exist, with the sizes it says, including a maskable one", async () => {
    expect(m.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of m.icons ?? []) {
      const meta = await sharp(`public${icon.src}`).metadata();
      expect(`${meta.width}x${meta.height}`).toBe(icon.sizes);
    }
  });
});

describe("where the logo is used", () => {
  it("shows the black logo in the site header and a small one while a signed-in screen loads", () => {
    for (const file of ["src/components/public/site-header.tsx", "src/components/student/use-me-data.tsx", "src/components/admin/use-admin-data.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toContain('src="/brand/logo.svg"');
    }
  });

  it("keeps the old blue out of the head of every page and the manifest", () => {
    for (const file of ["src/app/[locale]/layout.tsx", "src/app/manifest.ts"]) expect(readFileSync(file, "utf8"), file).not.toMatch(/1d4ed8/i);
  });
});
