import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampusEmbed, type CampusEmbedProps } from "@/components/public/campus-embed";
import { MarkdownView } from "@/components/public/markdown-view";
import { UniversityBrowser } from "@/components/public/university-browser";

/**
 * What the server sends before any script runs (FR-1, FR-3): the HTML of the interactive pieces. A visitor with JavaScript
 * off, and every visitor before a tap, gets exactly this.
 */

const labels: CampusEmbedProps["labels"] = {
  play: "Play video",
  openTour: "View 360° tour",
  needsConnection: "Needs a connection.",
  dataNotice: "May use a lot of data.",
  dataNoticeConfirm: "Open the tour",
  viewGallery: "View gallery",
  noThumbnail: "Preview not available",
};
const embed = (over: Partial<CampusEmbedProps>) => renderToStaticMarkup(createElement(CampusEmbed, { kind: "video", title: "Tour", youtubeId: "5ddvpNEqpec", url: null, thumbnail: null, labels, ...over }));

describe("FR-3: no iframe and no outside request before a tap", () => {
  it("a video renders a button and a placeholder, with no iframe and no youtube address anywhere", () => {
    const html = embed({});
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube");
    expect(html).toContain("Play video");
    expect(html).toContain("Preview not available");
  });

  it("a 360 tour renders a button only, with no iframe and no tour address", () => {
    const html = embed({ kind: "tour360", youtubeId: null, url: "https://tour.example/a/" });
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("tour.example");
    expect(html).toContain("View 360° tour");
  });

  it("uses our own thumbnail when there is one, never an outside picture", () => {
    const html = embed({ thumbnail: { src: `/media/${"a".repeat(64)}.webp`, width: 640, height: 360, alt: "Campus" } });
    expect(html).toContain(`src="/media/${"a".repeat(64)}.webp"`);
    expect(html).not.toContain("ytimg");
  });

  it("shows nothing for a video with a bad id or a tour with no address, instead of a broken frame", () => {
    expect(embed({ youtubeId: "bad" })).toBe("");
    expect(embed({ kind: "tour360", youtubeId: null, url: null })).toBe("");
  });

  it("a gallery is a link that opens in a new tab with no opener", () => {
    const html = embed({ kind: "gallery", youtubeId: null, url: "https://gallery.example/" });
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("<iframe");
  });
});

describe("A2: the universities list is complete in the HTML", () => {
  const item = (slug: string, name: string) => ({ slug, name, city: "Mohali", state: "Punjab", type: "private", naacGrade: "A+", logo: null, levels: [] });
  const html = renderToStaticMarkup(
    createElement(UniversityBrowser, {
      items: [item("alpha", "Alpha University"), item("beta", "Beta University")],
      labels: { search: "Search", searchPlaceholder: "Name", filterLevel: "Level", filterCity: "City", all: "All", noMatch: "None", results: "{count} shown", naac: "NAAC {grade}" },
    }),
  );

  it("shows each card with its link and its grade", () => {
    expect(html).toContain('href="/universities/alpha"');
    expect(html).toContain('href="/universities/beta"');
    expect(html).not.toContain("Fees");
    expect(html).toContain("NAAC A+");
    expect(html).toContain("2 shown");
  });
});

describe("A7: a post renders as text, never as markup", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownView, { source: "Hi **there**\n\n<script>window.x=1</script>\n\n[bad](javascript:alert) [good](https://example.com/a)\n\n![pixel](https://evil.example/p.png)\n\n```\n<b>code</b>\n```" }),
  );

  it("escapes raw HTML", () => {
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;code&lt;/b&gt;");
  });

  it("keeps https links, drops unsafe ones, and has no images", () => {
    expect(html).toContain('href="https://example.com/a"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>there</strong>");
  });
});
