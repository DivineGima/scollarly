import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Design review (2026-11-04). The tour preview picture carries height="360" (to reserve its space), and an HTML height attribute beats
 * `aspect-ratio`, so the preview was a 328 by 360 box showing the black bars of a 4:3 picture. The rule that fixes it is one line, so this
 * keeps it from being deleted.
 */
const css = readFileSync("src/app/[locale]/(public)/public.css", "utf8").split("\r\n").join("\n");
const block = (selector: string): string => {
  const start = css.indexOf(`
${selector} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
};

describe("design review: the tour preview", () => {
  it("is a 16:9 box whatever height the picture tag declares", () => {
    const poster = block(".poster");
    expect(poster).toMatch(/aspect-ratio:\s*16 \/ 9/);
    expect(poster).toMatch(/height:\s*auto/);
    expect(poster).toMatch(/object-fit:\s*cover/);
  });
});

describe("design review: the 404 page", () => {
  it("has its own words in both languages", () => {
    for (const locale of ["en", "fr"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as { site: { notFound: Record<string, string> } };
      expect(Object.keys(messages.site.notFound).sort()).toEqual(["body", "home", "title"]);
    }
  });
});
