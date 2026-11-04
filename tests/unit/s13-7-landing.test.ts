import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CourseFinder, type CourseFinderLabels } from "@/components/public/course-finder";
import { COURSE_FIELDS } from "@/lib/courses";
import { findUniversitiesByCourse, signUpHrefForCourse } from "@/modules/content/course-finder";
import type { CatalogueEntry } from "@/modules/student/ordering";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S13.7 (architecture 21.12; F13): the landing page's course finder. The pure rules are tested here, the markup the server sends before any
 * script runs, and the words in both languages. The page itself is exercised in tests/e2e/s13-7-landing.spec.ts.
 */

const uni = (name: string, naacGrade: string | null, fields: string[], city: string | null = null): CatalogueEntry => ({ slug: name.toLowerCase().replace(/\W+/g, "-"), name, city, naacGrade, fields });
const catalogue = [
  uni("Delta University", null, ["law"]),
  uni("Alpha University", "A", ["computer_science_it", "law"], "Pune"),
  uni("Beta University", "A++", ["mechanical_engineering"]),
  uni("Gamma University", "B+", ["computer_science_it"]),
];

describe("the universities for one course", () => {
  it("returns only universities that offer it, best NAAC grade first, then A to Z", () => {
    expect(findUniversitiesByCourse(catalogue, "computer_science_it").map((u) => u.name)).toEqual(["Alpha University", "Gamma University"]);
    expect(findUniversitiesByCourse(catalogue, "law").map((u) => u.name)).toEqual(["Alpha University", "Delta University"]);
  });
  it("puts a university with no stated grade last", () => {
    const list = findUniversitiesByCourse([uni("Zed", null, ["law"]), uni("Ace", "B", ["law"])], "law");
    expect(list.map((u) => u.name)).toEqual(["Ace", "Zed"]);
  });
  it("gives an empty list, not every university, for an empty, unknown or tampered value", () => {
    for (const value of ["", "astrology", "law ", "LAW", "__proto__", "constructor"]) expect(findUniversitiesByCourse(catalogue, value)).toEqual([]);
  });
  it("gives an empty list when no university offers a valid course", () => {
    expect(findUniversitiesByCourse(catalogue, "pharmacy")).toEqual([]);
  });
});

describe("the sign-up link", () => {
  it("carries a valid course into sign-up", () => {
    expect(signUpHrefForCourse("law")).toBe("/sign-up?course=law");
  });
  it("carries nothing for an empty or unknown value, so no injected text reaches the address", () => {
    for (const value of ["", "astrology", "law&as=admin", "../x", "<script>"]) expect(signUpHrefForCourse(value)).toBe("/sign-up");
  });
});

const labels: CourseFinderLabels = { ...en.home.finder, whatsapp: en.site.whatsapp.chat };

describe("the markup before any script runs", () => {
  const html = renderToStaticMarkup(createElement(CourseFinder, { catalogue, fields: COURSE_FIELDS, courseNames: { law: "Law", computer_science_it: "Computer Science and IT" }, labels, whatsappHref: "https://wa.me/14155550100" }));

  it("shows the prompt, a labelled select, and a sign-up button with no course", () => {
    expect(html).toContain(labels.prompt);
    expect(html).toContain("<label for=");
    expect(html).toContain('href="/sign-up"');
  });
  it("is hidden when JavaScript is off (it carries the js-only class)", () => {
    expect(html).toContain("js-only");
  });
  it("lists every course on the owner's list, with a readable name and the code as a fallback", () => {
    expect(html).toContain(">Law<");
    expect(html).toContain(">mechanical_engineering<");
    expect((html.match(/<option /g) ?? []).length).toBe(COURSE_FIELDS.length + 1);
  });
  it("shows no WhatsApp link until a course is chosen, so the first view is the prompt", () => {
    expect(html).not.toContain("finder-whatsapp");
  });
  it("makes no outside request before a tap and holds no personal data", () => {
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe("the words", () => {
  it("English and French have the same finder keys, and no key is empty", () => {
    expect(Object.keys(fr.home.finder).sort()).toEqual(Object.keys(en.home.finder).sort());
    for (const value of [...Object.values(en.home.finder), ...Object.values(fr.home.finder), en.home.logosHeading, fr.home.logosHeading]) expect(value.trim()).not.toBe("");
  });
  it("both count labels carry {count}", () => {
    for (const set of [en.home.finder, fr.home.finder]) {
      expect(set.countOne).toContain("{count}");
      expect(set.countOther).toContain("{count}");
    }
  });
});
