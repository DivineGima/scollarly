import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPublicPagePath } from "@/server/edge/fast-path";
import { legacyTarget } from "@/server/edge/legacy-redirects";
import { NAV_ITEMS } from "@/components/public/site-header";

const read = (path: string) => readFileSync(path, "utf8");

describe("S14.1: fees are gone from the public site (PRD_3, ADR-054)", () => {
  it("moves /fees to /universities, with or without the locale prefix", () => {
    expect(legacyTarget("/fees", "")).toBe("/universities");
    expect(legacyTarget("/en/fees", "")).toBe("/en/universities");
    expect(legacyTarget("/fees/", "?x=1")).toBe("/universities");
  });

  it("is no longer a cached public page and has no nav item", () => {
    expect(isPublicPagePath("/fees")).toBe(false);
    expect(NAV_ITEMS.map((item) => item.href)).not.toContain("/fees");
  });

  it("has no fee wording left in the public messages", () => {
    for (const locale of ["en", "fr"]) {
      const messages = JSON.parse(read(`messages/${locale}.json`)) as Record<string, Record<string, unknown>>;
      expect(messages.fees).toBeUndefined();
      expect(messages.universities).not.toHaveProperty("fromFee");
      expect(messages.universities).not.toHaveProperty("feesTbcShort");
      expect(messages.university).not.toHaveProperty("feesHeading");
      expect((messages.site as { nav: object }).nav).not.toHaveProperty("fees");
    }
  });

  it("drops 'Free for students' from the footer tagline only", () => {
    for (const locale of ["en", "fr"]) {
      const messages = JSON.parse(read(`messages/${locale}.json`)) as { site: { footer: { tagline: string } } };
      expect(messages.site.footer.tagline).not.toMatch(/free for students|gratuit pour les étudiants/i);
    }
  });
});

describe("S14.1: links are not underlined until hover or focus", () => {
  const css = read("src/app/globals.css");
  it("sets no underline on links, adds one on hover and focus and keeps it in long text", () => {
    expect(css).toMatch(/\na \{[^}]*text-decoration: none;/);
    expect(css).toMatch(/a:hover,\na:focus-visible \{\s*text-decoration: underline;/);
    expect(css).toMatch(/\.prose a \{\s*text-decoration: underline;/);
  });
});
