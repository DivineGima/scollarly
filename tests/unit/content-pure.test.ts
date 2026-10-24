import { describe, expect, it } from "vitest";
import { buildBlog, buildCatalogue, buildSite, buildTrust, headlineFee } from "@/modules/content/builders";
import { isYoutubeId, safeHttpsUrl, youtubeEmbedUrl } from "@/modules/content/embed";
import { confirmedRange, formatAmount, formatRange } from "@/modules/content/fees";
import { fixtureFileName, loadFixture } from "@/modules/content/fixture";
import { localisedField, localisedText } from "@/modules/content/localise";
import { parseInline, parseMarkdown, plainExcerpt, safeLinkHref } from "@/modules/content/markdown";
import { telHref } from "@/lib/phone";

describe("fee gating (FR-2)", () => {
  const fee = (over: Partial<Parameters<typeof confirmedRange>[0]> = {}) => ({ currency: "USD", dataConfirmed: true, amountMin: "3000.00", amountMax: "6000.00", ...over });

  it("shows a confirmed fee with a real range", () => {
    expect(confirmedRange(fee())).toEqual({ currency: "USD", min: 3000, max: 6000 });
    expect(confirmedRange(fee({ amountMin: 100, amountMax: 100 }))).toEqual({ currency: "USD", min: 100, max: 100 });
  });

  it("never shows an unconfirmed fee, a zero, a missing amount, a reversed range or an unknown currency", () => {
    for (const bad of [
      fee({ dataConfirmed: false }),
      fee({ amountMin: "0", amountMax: "6000" }),
      fee({ amountMin: "-5", amountMax: "6000" }),
      fee({ amountMin: null }),
      fee({ amountMax: null }),
      fee({ amountMin: "6000", amountMax: "3000" }),
      fee({ amountMin: "abc" }),
      fee({ currency: "EUR" }),
    ]) {
      expect(confirmedRange(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("formats the same way on every device and never sums currencies", () => {
    expect(formatAmount(3000)).toBe("3,000");
    expect(formatAmount(1234567)).toBe("1,234,567");
    expect(formatAmount(1920.5)).toBe("1,920.50");
    expect(formatRange({ currency: "USD", min: 3000, max: 6000 })).toBe("USD 3,000 – 6,000");
    expect(formatRange({ currency: "INR", min: 150000, max: 150000 })).toBe("INR 150,000");
  });

  it("quotes the lowest tuition line in one currency on a card, and nothing when no fee is confirmed", () => {
    const line = (id: string, currency: "USD" | "INR", min: number, period: string) => ({ id, currency, min, max: min + 1, period, lastUpdatedAt: "2026-01-01T00:00:00.000Z", programmeId: null });
    expect(headlineFee({ fees: [] })).toBeNull();
    expect(headlineFee({ fees: [line("a", "USD", 1920, "hostel per year"), line("b", "USD", 3000, "tuition per year"), line("c", "USD", 2500, "tuition per year")] })?.id).toBe("c");
    // Currencies are never compared: the first tuition line's currency wins.
    expect(headlineFee({ fees: [line("a", "USD", 3000, "tuition per year"), line("b", "INR", 100, "tuition per year")] })?.id).toBe("a");
    expect(headlineFee({ fees: [line("a", "USD", 500, "hostel per year")] })?.id).toBe("a");
  });
});

describe("video and tour facades (FR-3)", () => {
  it("accepts only an 11 character YouTube id and builds a youtube-nocookie address", () => {
    expect(isYoutubeId("5ddvpNEqpec")).toBe(true);
    for (const bad of ["", "short", "5ddvpNEqpecX", "5ddvpNEqpe!", "5ddvpNEqpe ", null, undefined, 42, "../../etc/pa"]) expect(isYoutubeId(bad), String(bad)).toBe(false);
    expect(youtubeEmbedUrl("5ddvpNEqpec")).toBe("https://www.youtube-nocookie.com/embed/5ddvpNEqpec?autoplay=1&rel=0&modestbranding=1");
    expect(youtubeEmbedUrl("bad")).toBeNull();
    expect(youtubeEmbedUrl("5ddvpNEqpec")).not.toContain("youtube.com/embed");
  });

  it("accepts only plain https addresses for tours and links", () => {
    expect(safeHttpsUrl("https://tour.example/a/")).toBe("https://tour.example/a/");
    for (const bad of ["http://tour.example/", "javascript:alert(1)", "data:text/html,x", "https://user:pw@tour.example/", "//tour.example", "not a url", "", null, undefined, `https://x.example/${"a".repeat(600)}`]) {
      expect(safeHttpsUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("Markdown (ADR-028): a post can never inject markup", () => {
  it("shows raw HTML as text", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
    expect(JSON.stringify(blocks)).toContain("<script>alert(1)</script>");
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("links only https, http and mailto; everything else becomes plain text", () => {
    expect(safeLinkHref("https://example.com/x")).toBe("https://example.com/x");
    expect(safeLinkHref("mailto:a@example.com")).toBe("mailto:a@example.com");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example", "ftp://x.example", "https://u:p@x.example", ""]) {
      expect(safeLinkHref(bad), bad).toBeNull();
    }
    expect(parseInline("[click](javascript:alert(1))").some((n) => n.type === "link")).toBe(false);
    expect(parseInline("[click](javascript:void)")).toEqual([{ type: "text", text: "click" }]);
    expect(parseInline("[ok](https://example.com)")).toEqual([{ type: "link", href: "https://example.com/", children: [{ type: "text", text: "ok" }] }]);
  });

  it("supports the basics: headings (shifted below the page h1), lists, quotes, code, bold and italic", () => {
    const blocks = parseMarkdown("# One\n\n### Three\n\nHello **bold** and *italic* and `code`.\n\n- a\n- b\n\n1. x\n2. y\n\n> quoted\n\n```\nlet a = 1 < 2;\n```");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "heading", "paragraph", "list", "list", "quote", "code"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(blocks[1]).toMatchObject({ type: "heading", level: 4 });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[4]).toMatchObject({ type: "list", ordered: true });
    expect(blocks[6]).toEqual({ type: "code", text: "let a = 1 < 2;" });
  });

  it("does not support images, and survives unbalanced or hostile input", () => {
    expect(JSON.stringify(parseMarkdown("![pixel](https://evil.example/x.png)"))).not.toContain('"img"');
    expect(() => parseMarkdown("**unclosed *mess [a](b `c")).not.toThrow();
    expect(() => parseMarkdown("*".repeat(5000))).not.toThrow();
    expect(parseMarkdown("")).toEqual([]);
  });

  it("makes a plain excerpt of the first paragraph, cut at a word", () => {
    expect(plainExcerpt("Start with **your results** today.\n\nSecond paragraph.")).toBe("Start with your results today.");
    const long = plainExcerpt(`${"word ".repeat(100)}`, 40);
    expect(long.length).toBeLessThanOrEqual(41);
    expect(long.endsWith("…")).toBe(true);
    expect(plainExcerpt("")).toBe("");
  });
});

describe("translated text (decision D19)", () => {
  it("reads a field from the locale object, else the plain English column", () => {
    const translations = { fr: { question: "Est-ce gratuit ?" } };
    expect(localisedField(translations, "fr", "question", "Is it free?")).toBe("Est-ce gratuit ?");
    expect(localisedField(translations, "fr", "answer", "Yes")).toBe("Yes");
    expect(localisedField(translations, "en", "question", "Is it free?")).toBe("Is it free?");
    expect(localisedField({}, "fr", "question", "Is it free?")).toBe("Is it free?");
    expect(localisedField(null, "fr", "question", "Is it free?")).toBe("Is it free?");
    expect(localisedField({ fr: { question: "   " } }, "fr", "question", "Is it free?")).toBe("Is it free?");
  });

  it("reads the whole-text shape of content blocks and university overviews, with the English fallback", () => {
    expect(localisedText({ en: "Hello", fr: "Bonjour" }, "fr")).toBe("Bonjour");
    expect(localisedText({ en: "Hello" }, "fr")).toBe("Hello");
    expect(localisedText({ en: "  " }, "en", "fallback")).toBe("fallback");
    expect(localisedText(undefined, "en")).toBe("");
  });
});

describe("builders apply the publish rules a second time", () => {
  const media = [{ id: "m1", sha256: "a".repeat(64), width: 100, height: 50, alt: { en: "Logo" } }];
  const university = { id: "u1", slug: "alpha", name: "Alpha", city: "C", state: "S", type: "private", naacGrade: "A", websiteUrl: "http://insecure.example", logoMediaId: "m1", translations: { en: "Overview" } };
  const base = { universities: [university], programmes: [], fees: [], experiences: [], resources: [], media };

  it("drops an unconfirmed or invalid fee even if it reached the builder", () => {
    const fee = (over: object) => ({ id: "f", universityId: "u1", programmeId: null, currency: "USD", amountMin: "100", amountMax: "200", period: "tuition per year", dataConfirmed: true, lastUpdatedAt: new Date("2026-01-01T00:00:00Z"), ...over });
    const result = buildCatalogue({ ...base, fees: [fee({ id: "ok" }), fee({ id: "x1", dataConfirmed: false }), fee({ id: "x2", amountMin: "0" }), fee({ id: "x3", amountMax: "50" })] });
    expect(result.universities[0]?.fees.map((f) => f.id)).toEqual(["ok"]);
  });

  it("keeps a video only with a valid id, a tour only with an https address, and drops http websites and resources", () => {
    const experience = (over: object) => ({ id: "e", universityId: "u1", kind: "video", title: "T", youtubeId: null, url: null, thumbnailMediaId: null, ...over });
    const result = buildCatalogue({
      ...base,
      experiences: [
        experience({ id: "v-ok", youtubeId: "5ddvpNEqpec" }),
        experience({ id: "v-bad", youtubeId: "nope" }),
        experience({ id: "t-ok", kind: "tour360", url: "https://tour.example/" }),
        experience({ id: "t-http", kind: "tour360", url: "http://tour.example/" }),
        experience({ id: "t-js", kind: "tour360", url: "javascript:alert(1)" }),
        experience({ id: "g-ok", kind: "gallery", url: "https://gallery.example/" }),
      ],
      resources: [
        { id: "r-ok", universityId: "u1", title: "Prospectus", url: "https://x.example/p.pdf", kind: null },
        { id: "r-bad", universityId: "u1", title: "Bad", url: "http://x.example/p.pdf", kind: null },
      ],
    });
    const u = result.universities[0]!;
    expect(u.experiences.map((e) => e.id)).toEqual(["v-ok", "t-ok", "g-ok"]);
    expect(u.resources.map((r) => r.id)).toEqual(["r-ok"]);
    expect(u.websiteUrl).toBeNull();
    expect(u.logo).toEqual({ sha256: "a".repeat(64), width: 100, height: 50, alt: "Logo" });
    expect(u.overview).toBe("Overview");
  });

  it("ignores an image whose hash is not a sha-256", () => {
    const result = buildCatalogue({ ...base, media: [{ ...media[0]!, sha256: "../../etc/passwd" }] });
    expect(result.universities[0]?.logo).toBeNull();
  });

  it("shows only confirmed figures, verified and consented testimonials and journeys, and confirmed bios", () => {
    const trust = buildTrust({
      stats: [
        { key: "a", label: "A", value: "1", asOf: null, confirmed: true, translations: {} },
        { key: "b", label: "B", value: "2", asOf: null, confirmed: false, translations: {} },
      ],
      testimonials: [
        { id: "t1", studentName: "Ok", country: null, universityId: "u1", quote: "q", photoMediaId: null, verified: true, consentId: "c1", translations: {} },
        { id: "t2", studentName: "No consent", country: null, universityId: null, quote: "q", photoMediaId: null, verified: true, consentId: null, translations: {} },
        { id: "t3", studentName: "Unverified", country: null, universityId: null, quote: "q", photoMediaId: null, verified: false, consentId: "c3", translations: {} },
      ],
      journeys: [
        { id: "j1", studentName: "Ok", country: null, universityId: null, summary: "s", verified: true, consentId: "c1", translations: {} },
        { id: "j2", studentName: "No consent", country: null, universityId: null, summary: "s", verified: true, consentId: null, translations: {} },
      ],
      steps: [{ journeyId: "j1", position: 1, title: "Step", body: "b", dateLabel: null }],
      team: [
        { id: "m1", name: "Confirmed", roleTitle: "Adviser", bio: "b", photoMediaId: null, confirmed: true, translations: {} },
        { id: "m2", name: "Unconfirmed", roleTitle: "Adviser", bio: "b", photoMediaId: null, confirmed: false, translations: {} },
      ],
      universities: [{ id: "u1", name: "Alpha" }],
      media,
    });
    expect(trust.stats.map((s) => s.key)).toEqual(["a"]);
    expect(trust.testimonials.map((t) => t.id)).toEqual(["t1"]);
    expect(trust.testimonials[0]?.universityName).toBe("Alpha");
    expect(trust.journeys.map((j) => j.id)).toEqual(["j1"]);
    expect(trust.journeys[0]?.steps).toHaveLength(1);
    expect(trust.team.map((m) => m.id)).toEqual(["m1"]);
  });

  it("reads the two contact settings, refusing a number that is not valid E.164", () => {
    const rows = (whatsapp: unknown, display: unknown) => ({ faqs: [], steps: [], blocks: [], settings: [{ key: "whatsapp_number_e164", value: whatsapp }, { key: "contact_phone_display", value: display }] });
    expect(buildSite(rows("+14155550100", "+1 415 555 0100")).contact).toEqual({ whatsappE164: "+14155550100", phoneDisplay: "+1 415 555 0100" });
    expect(buildSite(rows(null, null)).contact).toEqual({ whatsappE164: null, phoneDisplay: null });
    expect(buildSite(rows("0612345678", "  ")).contact).toEqual({ whatsappE164: null, phoneDisplay: null });
  });

  it("lists copy blocks that have text and keeps only the application and visa steps", () => {
    const site = buildSite({
      faqs: [],
      steps: [
        { id: "s1", kind: "application", position: 1, title: "T", body: "B", translations: {} },
        { id: "s2", kind: "other", position: 1, title: "T", body: "B", translations: {} },
      ],
      blocks: [
        { key: "hero.title", translations: { en: "Hello" } },
        { key: "empty", translations: { en: "  " } },
      ],
      settings: [],
    });
    expect(site.processSteps.map((s) => s.id)).toEqual(["s1"]);
    expect(site.blocks).toEqual({ "hero.title": "Hello" });
  });

  it("lists published posts newest first as the query returned them, with an excerpt, and skips an unpublished date", () => {
    const blog = buildBlog({
      posts: [
        { slug: "a", title: "A", body: "First **para**.\n\nMore.", coverMediaId: "m1", publishedAt: new Date("2026-10-20T08:00:00Z"), translations: {} },
        { slug: "b", title: "B", body: "Body", coverMediaId: null, publishedAt: null, translations: {} },
      ],
      media,
    });
    expect(blog.posts.map((p) => p.slug)).toEqual(["a"]);
    expect(blog.posts[0]?.excerpt).toBe("First para.");
    expect(blog.posts[0]?.publishedAt).toBe("2026-10-20T08:00:00.000Z");
    expect(blog.posts[0]?.cover?.sha256).toBe("a".repeat(64));
  });
});

describe("the build-time content fixture seam (S3.5)", () => {
  it("is off unless the variable is set, and never in the running production server", async () => {
    expect(fixtureFileName({})).toBeNull();
    expect(fixtureFileName({ CONTENT_FIXTURE_FILE: "x.json", NEXT_PHASE: "phase-production-server" })).toBeNull(); // a running site never reads it
    expect(fixtureFileName({ CONTENT_FIXTURE_FILE: "x.json", NEXT_PHASE: "phase-production-build" })).toBe("x.json");
    expect(fixtureFileName({ CONTENT_FIXTURE_FILE: "x.json" })).toBe("x.json"); // the static generation workers of a build
    expect(await loadFixture("site", {})).toBeNull();
  });

  it("reads one snapshot from the file during a build", async () => {
    const site = await loadFixture<{ contact: unknown }>("site", { CONTENT_FIXTURE_FILE: "tests/fixtures/content-snapshot.json", NEXT_PHASE: "phase-production-build" });
    expect(site?.contact).toEqual({ whatsappE164: "+14155550100", phoneDisplay: "+1 415 555 0100" });
  });
});

describe("telHref", () => {
  it("makes a tel link from a written number, and refuses what is not a number", () => {
    expect(telHref("+1 415 555 0100")).toBe("tel:+14155550100");
    expect(telHref("+91 (98157) 25-968")).toBe("tel:+919815725968");
    for (const bad of ["", "   ", "call us", "0612345678", null, undefined]) expect(telHref(bad), String(bad)).toBeNull();
  });
});
