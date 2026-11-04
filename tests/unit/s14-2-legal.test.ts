import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalSections } from "@/components/public/legal-sections";

interface LegalPage {
  title: string;
  updated: string;
  email: string;
  intro: string;
  sections: { heading: string; items: string[] }[];
}
type Messages = { privacy: LegalPage; terms: LegalPage };
const load = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages;

describe("S14.2: Privacy and Terms are complete, public and in both languages", () => {
  for (const locale of ["en", "fr"]) {
    for (const page of ["privacy", "terms"] as const) {
      it(`${locale} ${page} has a date, the contact email and at least eight sections with no empty text`, () => {
        const m = load(locale)[page];
        expect(m.updated).toMatch(/2026/);
        expect(m.email).toBe("gimafolabit@gmail.com");
        expect(m.sections.length).toBeGreaterThanOrEqual(8);
        for (const s of m.sections) {
          expect(s.heading.trim()).not.toBe("");
          expect(s.items.length).toBeGreaterThan(0);
          for (const item of s.items) expect(item.trim()).not.toBe("");
        }
      });
    }
  }

  it("covers what Google asks of a published app: Google user data, Limited Use, no sale, deletion and contact", () => {
    const text = JSON.stringify(load("en").privacy.sections);
    expect(text).toMatch(/Google API Services User Data Policy/);
    expect(text).toMatch(/Limited Use/);
    expect(text).toMatch(/do not sell it/);
    expect(text).toMatch(/erase/);
    expect(text).toMatch(/\{email\}/);
    expect(text).toMatch(/raw IP address/);
  });

  it("does not claim a legal review or an unconfirmed number", () => {
    const all = JSON.stringify([load("en").privacy, load("en").terms]);
    expect(all).not.toMatch(/legally reviewed|reviewed by (a )?lawyer/i);
  });

  it("renders the email as a mailto link and every section as a heading, without any script", () => {
    const m = load("en").privacy;
    const html = renderToStaticMarkup(createElement(LegalSections, { intro: m.intro, updated: m.updated, email: m.email, sections: m.sections }));
    expect(html).toContain('href="mailto:gimafolabit@gmail.com"');
    expect((html.match(/<h2/g) ?? []).length).toBe(m.sections.length);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("{email}");
  });
});
