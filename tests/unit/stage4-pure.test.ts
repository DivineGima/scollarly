import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "@/lib/constants";
import { pageGroupOf, PAGE_GROUPS } from "@/lib/page-group";
import { isBuildAsset, isMediaImage, isNeverCached } from "@/lib/sw-rules";
import { eventsBodySchema, MAX_EVENTS_PER_BATCH } from "@/modules/events/schema";
import { countKey, planEvents } from "@/modules/events/service";
import { cachedSlaSettings, pageViewsEnabled, resetSettingsCache, SETTINGS_TTL_MS } from "@/server/edge/settings-cache";
import type { Db } from "@/server/db/client";

const REF = "SC-ABCDE-FGHJK";
const UNI = "0194f3c2-8a4b-7c1d-9e2f-3a4b5c6d7e80";

describe("S4.5: events (architecture 8.2, 10.3)", () => {
  const body = (events: unknown[]) => eventsBodySchema.safeParse({ events });

  it("accepts the five event types, a batch of up to 50, and nothing identifying", () => {
    expect(MAX_EVENTS_PER_BATCH).toBe(50);
    for (const type of EVENT_TYPES) expect(body([{ type }]).success, type).toBe(true);
    expect(body([{ type: "wa_tap", lead_ref: REF, session_id: "abcdef0123456789", university_id: UNI, page_group: "university", occurred_at: "2026-10-23T22:00:00Z" }]).success).toBe(true);
    expect(body(Array.from({ length: 50 }, () => ({ type: "page_view" }))).success).toBe(true);
  });

  it("refuses an empty batch, more than 50, unknown types and fields, a client country, and a malformed reference or group", () => {
    expect(body([]).success).toBe(false);
    expect(body(Array.from({ length: 51 }, () => ({ type: "page_view" }))).success).toBe(false);
    expect(body([{ type: "purchase" }]).success).toBe(false);
    expect(body([{ type: "page_view", country: "NG" }]).success).toBe(false); // the server ignores any client country: there is no such field
    expect(body([{ type: "page_view", name: "Ama" }]).success).toBe(false);
    expect(body([{ type: "wa_tap", lead_ref: "not-a-ref" }]).success).toBe(false);
    expect(body([{ type: "page_view", page_group: "/universities/secret-slug" }]).success).toBe(false);
    expect(eventsBodySchema.safeParse({ events: [{ type: "page_view" }], extra: 1 }).success).toBe(false);
  });

  const plan = (events: Parameters<typeof planEvents>[0], over: Partial<Parameters<typeof planEvents>[1]> = {}) =>
    planEvents(events, { country: "CM", now: new Date("2026-10-23T22:30:00Z"), collectPageViews: true, ...over });

  it("only a wa_tap with a lead reference becomes a row; every other event is only a count (the Stage 4 exit criterion)", () => {
    const result = plan([
      { type: "page_view", page_group: "home" },
      { type: "form_start", university_id: UNI },
      { type: "form_submit" },
      { type: "install" },
      { type: "wa_tap" }, // no reference: counted, not stored
      { type: "wa_tap", lead_ref: REF },
    ]);
    expect(result.taps).toHaveLength(1);
    expect(result.taps[0]).toMatchObject({ leadRef: REF, country: "CM" });
    expect(Object.values(result.counts).reduce((a, b) => a + b, 0)).toBe(5);
    for (const type of ["page_view", "form_start", "form_submit", "install"]) {
      expect(result.taps.some((t) => (t as unknown as { type?: string }).type === type)).toBe(false);
    }
  });

  it("counts by WAT date, type, country, university and page group; the date is the WAT day, not the UTC day", () => {
    // 22:30 UTC on the 23rd is 23:30 WAT on the 23rd; 23:30 UTC is already the 24th in WAT.
    expect(Object.keys(plan([{ type: "page_view", page_group: "home" }]).counts)).toEqual(["agg:2026-10-23:page_view:CM:-:home"]);
    expect(Object.keys(plan([{ type: "page_view" }], { now: new Date("2026-10-23T23:30:00Z") }).counts)).toEqual(["agg:2026-10-24:page_view:CM:-:-"]);
    expect(countKey({ date: "2026-10-23", type: "form_start", country: null, universityId: UNI, pageGroup: null })).toBe(`agg:2026-10-23:form_start:-:${UNI}:-`);
  });

  it("adds equal events together", () => {
    const result = plan([{ type: "page_view", page_group: "home" }, { type: "page_view", page_group: "home" }, { type: "page_view", page_group: "faq" }]);
    expect(result.counts["agg:2026-10-23:page_view:CM:-:home"]).toBe(2);
    expect(result.counts["agg:2026-10-23:page_view:CM:-:faq"]).toBe(1);
  });

  it("takes the country from the edge only, and drops anything that is not two capital letters", () => {
    expect(Object.keys(plan([{ type: "install" }], { country: null }).counts)[0]).toBe("agg:2026-10-23:install:-:-:-");
    expect(Object.keys(plan([{ type: "install" }], { country: "cm" }).counts)[0]).toContain(":-:");
    expect(Object.keys(plan([{ type: "install" }], { country: "Nigeria" }).counts)[0]).toContain(":-:");
  });

  it("the kill switch drops page views only; form events, installs and taps still count (ADR-003)", () => {
    const result = plan([{ type: "page_view" }, { type: "form_start" }, { type: "wa_tap", lead_ref: REF }], { collectPageViews: false });
    expect(result.dropped).toBe(1);
    expect(Object.keys(result.counts)).toEqual(["agg:2026-10-23:form_start:CM:-:-"]);
    expect(result.taps).toHaveLength(1);
  });

  it("names a page group, never a path", () => {
    expect(pageGroupOf("/")).toBe("home");
    expect(pageGroupOf("/universities/")).toBe("universities");
    expect(pageGroupOf("/universities/alpha-university")).toBe("university");
    expect(pageGroupOf("/blog/how-to-apply")).toBe("post");
    expect(pageGroupOf("/campus-tours")).toBe("tours");
    expect(pageGroupOf("/admin/leads/123")).toBe("other");
    expect(pageGroupOf("/some/secret?x=1")).toBe("other");
    for (const path of ["/", "/universities", "/fees", "/apply", "/blog/x", "/zzz"]) expect(PAGE_GROUPS).toContain(pageGroupOf(path));
  });
});

describe("S4.1: what the service worker may keep (architecture 11.1)", () => {
  it("never caches the signed-in areas, the auth pages and steps, or any API route", () => {
    for (const path of ["/admin", "/admin/leads", "/me", "/me/progress", "/api/v1/leads", "/api/v1/events", "/api/auth/get-session", "/auth/start", "/auth/return", "/auth/landing", "/sign-in", "/sign-out", "/accept-invite/abc", "/two-factor/enrol", "/two-factor/verify", "/verify-email", "/forgot-password"]) {
      expect(isNeverCached(path), path).toBe(true);
    }
  });

  it("keeps public pages, build files and images cacheable, and does not mistake a page that starts with the same letters", () => {
    for (const path of ["/", "/universities", "/apply", "/blog/me-and-my-visa", "/mexico-study-guide", "/administration", "/media/abc.webp", "/_next/static/chunks/a.js"]) {
      expect(isNeverCached(path), path).toBe(false);
    }
    expect(isBuildAsset("/_next/static/chunks/app.js")).toBe(true);
    expect(isBuildAsset("/_next/data/x.json")).toBe(false);
    expect(isMediaImage(`/media/${"a".repeat(64)}.webp`)).toBe(true);
  });
});

describe("the settings the plain-function endpoints read", () => {
  const fakeDb = (values: Record<string, unknown>, calls: { n: number }) =>
    ({
      // `readSettings` runs one `select` through `runPublic`; emulate the driver by answering the batch.
      batch: async () => {
        calls.n += 1;
        return [[], Object.entries(values).map(([key, value]) => ({ key, value }))];
      },
      execute: async () => [],
      select: () => ({ from: () => Promise.resolve([]) }),
    }) as unknown as Db;

  it("keeps the values for a minute so a request does not pay a database round trip, then reads them again", async () => {
    resetSettingsCache();
    // Read through the real repository with a stub that counts batches.
    const calls = { n: 0 };
    const db = {
      batch: async () => {
        calls.n += 1;
        return [{}, [{ key: "sla_weekday_hours", value: 2 }, { key: "collect_page_views", value: false }]];
      },
      execute: () => Promise.resolve(),
      select: () => ({ from: () => Promise.resolve() }),
    } as unknown as Db;
    void fakeDb;
    const t0 = 1_800_000_000_000;
    expect(await cachedSlaSettings(db, "k", t0)).toEqual({ weekdayHours: 2, weekendHours: 24 });
    expect(await pageViewsEnabled(db, "k", t0 + 1000)).toBe(false);
    expect(calls.n).toBe(1);
    await cachedSlaSettings(db, "k", t0 + SETTINGS_TTL_MS + 1);
    expect(calls.n).toBe(2);
    resetSettingsCache();
  });
});

/**
 * FR-4 and the Stage 4 exit criterion: no WhatsApp number is written in the code. Every number comes from `site_setting` through
 * `lib/whatsapp.ts`. This scans the source and the message files for anything that looks like a phone number or a `wa.me` link.
 */
describe("no hardcoded WhatsApp number or link (FR-4, S4.6)", () => {
  const ROOT = process.cwd();
  const SKIP_DIRS = new Set(["node_modules", ".next", ".open-next", ".git", "migrations"]);
  function files(dir: string, extensions: string[]): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (SKIP_DIRS.has(name)) return [];
      return statSync(full).isDirectory() ? files(full, extensions) : extensions.some((e) => name.endsWith(e)) ? [full] : [];
    });
  }
  const sources = [...files(join(ROOT, "src"), [".ts", ".tsx", ".css"]), ...files(join(ROOT, "messages"), [".json"]), ...files(join(ROOT, "worker"), [".ts"]), ...files(join(ROOT, "public"), [".webmanifest"])];
  const rel = (file: string) => relative(ROOT, file).split(sep).join("/");

  it("finds the source files it is meant to scan", () => {
    expect(sources.length).toBeGreaterThan(80);
  });

  it("builds a wa.me link in exactly one place, the helper", () => {
    const offenders = sources.filter((f) => /wa\.me|api\.whatsapp\.com|whatsapp:\/\/send/.test(readFileSync(f, "utf8")) && rel(f) !== "src/lib/whatsapp.ts");
    expect(offenders.map(rel)).toEqual([]);
  });

  it("contains no telephone number: no run of 9 or more digits and no international number with a plus sign", () => {
    const international = /\+\d{1,3}[\s.-]?\(?\d{1,5}\)?([\s.-]?\d{2,5}){2,}/;
    const longDigits = /(?<![\w.#-])\d{9,}(?![\w-])/;
    const offenders: string[] = [];
    for (const file of sources) {
      const path = rel(file);
      // The phone rules and their documentation use country codes and lengths, not numbers; the tests are not scanned.
      const text = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      if (international.test(text) || longDigits.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
