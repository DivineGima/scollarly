import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { YOUTUBE_ID_PATTERN } from "@/lib/constants";
import { TOUR_FRAME_ORIGINS } from "@/lib/tour-hosts";
import { buildCatalogue } from "@/modules/content/builders";
import { isTourFrameUrl } from "@/modules/content/embed";

interface Video {
  slug: string;
  youtube_id: string;
  channel: string;
  title: string;
  source: string;
}
interface SeedUniversity {
  slug: string;
  campus_experiences?: { kind: string; youtube_id?: string; thumbnail?: { file: string; alt?: string }; url?: string }[];
}

const read = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");
const list = JSON.parse(read("data/seed/tour-videos.json")) as { videos: Video[]; without_video: string[] };
const universities = JSON.parse(read("data/seed/universities.json")) as SeedUniversity[];

describe("S14.6: the verified tour videos (PRD_3 F22)", () => {
  it("has one valid, unique video id per university, with its source and channel recorded", () => {
    expect(list.videos.length).toBeGreaterThanOrEqual(8);
    const ids = list.videos.map((v) => v.youtube_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const video of list.videos) {
      expect(video.youtube_id, video.slug).toMatch(YOUTUBE_ID_PATTERN);
      expect(video.source, video.slug).toBe(`https://www.youtube.com/watch?v=${video.youtube_id}`);
      expect(video.channel.trim(), video.slug).not.toBe("");
    }
  });

  it("is what the seed holds: every listed university has that video and a preview file of our own", () => {
    for (const video of list.videos) {
      const university = universities.find((u) => u.slug === video.slug);
      expect(university, video.slug).toBeDefined();
      const found = university?.campus_experiences?.find((e) => e.kind === "video");
      expect(found?.youtube_id, video.slug).toBe(video.youtube_id);
      expect(found?.thumbnail?.file, video.slug).toBe(`tour-thumbs/${video.slug}.webp`);
      expect(existsSync(`data/seed/${found?.thumbnail?.file}`), video.slug).toBe(true);
      expect(found?.thumbnail?.alt?.trim(), video.slug).toBeTruthy();
    }
  });

  it("says which universities have none, and those have no tour in the seed (so the tours page hides them)", () => {
    for (const slug of list.without_video) {
      const university = universities.find((u) => u.slug === slug);
      expect(university?.campus_experiences ?? [], slug).toEqual([]);
    }
  });

  it("keeps no old unverified video in the seed", () => {
    const wanted = new Set(list.videos.map((v) => v.youtube_id));
    for (const university of universities) {
      for (const experience of university.campus_experiences ?? []) {
        if (experience.kind === "video") expect(wanted.has(experience.youtube_id ?? ""), `${university.slug} ${experience.youtube_id}`).toBe(true);
      }
    }
  });
});

describe("S14.6: the 360 tour hosts and the preview fallback", () => {
  it("allows a 360 tour only on a listed host, and every seeded 360 tour is on one", () => {
    expect(isTourFrameUrl("https://www.iviewd.com/cu2/")).toBe(true);
    expect(isTourFrameUrl("https://virtualtour.kalingauniversity.ac.in/")).toBe(true);
    expect(isTourFrameUrl("https://tour.example/")).toBe(false);
    expect(isTourFrameUrl("http://www.iviewd.com/cu2/")).toBe(false);
    expect(isTourFrameUrl("https://www.iviewd.com.evil.example/")).toBe(false);
    expect(isTourFrameUrl(null)).toBe(false);
    for (const university of universities) {
      for (const experience of university.campus_experiences ?? []) {
        if (experience.kind === "tour360") expect(TOUR_FRAME_ORIGINS, university.slug).toContain(new URL(experience.url ?? "").origin);
      }
    }
  });

  it("lets a tour with no preview use the university's video preview, and leaves a lone tour alone", () => {
    const media = [{ id: "m1", sha256: "a".repeat(64), width: 480, height: 360, alt: { en: "Preview" } }];
    const university = { id: "u1", slug: "alpha", name: "Alpha", city: "C", state: "S", type: "private", naacGrade: "A", websiteUrl: null, logoMediaId: null, translations: { en: "" } };
    const experience = (over: object) => ({ id: "e", universityId: "u1", kind: "video", title: "T", youtubeId: null, url: null, thumbnailMediaId: null, ...over });
    const result = buildCatalogue({
      universities: [university],
      programmes: [],
      experiences: [experience({ id: "v", youtubeId: "5ddvpNEqpec", thumbnailMediaId: "m1" }), experience({ id: "t", kind: "tour360", url: "https://www.iviewd.com/cu2/" })],
      resources: [],
      media,
    } as unknown as Parameters<typeof buildCatalogue>[0]);
    const [video, tour] = result.universities[0]?.experiences ?? [];
    expect(video?.thumbnail?.sha256).toBe("a".repeat(64));
    expect(tour?.thumbnail?.sha256).toBe("a".repeat(64));

    const lone = buildCatalogue({
      universities: [university],
      programmes: [],
      experiences: [experience({ id: "t", kind: "tour360", url: "https://www.iviewd.com/cu2/" })],
      resources: [],
      media,
    } as unknown as Parameters<typeof buildCatalogue>[0]);
    expect(lone.universities[0]?.experiences[0]?.thumbnail).toBeNull();
  });
});

describe("S14.6: the tours page lists only universities with a tour", () => {
  const page = read("src/app/[locale]/(public)/campus-tours/page.tsx");
  it("has no 'available on request' text and no WhatsApp fallback", () => {
    expect(page).not.toMatch(/onRequest|WhatsAppButton/);
    expect(page).toMatch(/experiences\.length > 0/);
  });

  it("no message file still carries the old text", () => {
    for (const locale of ["en", "fr"]) {
      expect(read(`messages/${locale}.json`)).not.toMatch(/Available on request|Disponible sur demande/);
    }
  });
});
