import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile, match } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { pickNamespaces } from "@/i18n/messages";
import { localeRewrites } from "@/i18n/rewrites";

/** Applies the rewrites the way Next.js does: the first rule whose source matches the path wins. */
function rewrite(path: string): string {
  for (const rule of localeRewrites()) {
    const matched = match(rule.source, { decode: decodeURIComponent })(path);
    if (matched) return compile(rule.destination, { validate: false })(matched.params);
  }
  return path;
}

describe("S1.6: unprefixed paths are rewritten to /en (ADR-018)", () => {
  it("rewrites the home page and every public page", () => {
    expect(rewrite("/")).toBe("/en");
    expect(rewrite("/offline")).toBe("/en/offline");
    expect(rewrite("/universities")).toBe("/en/universities");
    expect(rewrite("/universities/jain-university")).toBe("/en/universities/jain-university");
    expect(rewrite("/blog/how-to-apply")).toBe("/en/blog/how-to-apply");
    expect(rewrite("/admin/leads/123")).toBe("/en/admin/leads/123");
    expect(rewrite("/me/phase0")).toBe("/en/me/phase0");
  });

  it("leaves a path that already has the locale alone, but not one that only starts with the same letters", () => {
    expect(rewrite("/en")).toBe("/en");
    expect(rewrite("/en/universities")).toBe("/en/universities");
    expect(rewrite("/english-guide")).toBe("/en/english-guide");
    expect(rewrite("/entry")).toBe("/en/entry");
  });

  it("leaves API routes, sign-in steps, images and build output alone", () => {
    for (const path of ["/api/v1/health", "/api/auth/get-session", "/auth/start", "/auth/return", "/media/abc", "/_next/static/chunks/main.js", "/_next/data/x.json"]) {
      expect(rewrite(path), path).toBe(path);
    }
  });

  it("leaves files alone: the service worker, the manifest and icons", () => {
    for (const path of ["/sw.js", "/swe-worker-5c72df51bb1f6ee0.js", "/manifest.webmanifest", "/icon.svg", "/favicon.ico", "/robots.txt"]) {
      expect(rewrite(path), path).toBe(path);
    }
  });

  it("names every active locale in the skip list, so adding French needs one line in config.ts", () => {
    expect(locales).toEqual(["en"]);
    expect(localeRewrites()[1]?.source).toContain("en(?:/|$)");
  });
});

const read = (locale: string) => JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Record<string, unknown>;

/** `home.title` style paths of every string in the catalogue. */
function leaves(node: unknown, prefix = ""): { path: string; value: string }[] {
  if (typeof node === "string") return [{ path: prefix, value: node }];
  if (node && typeof node === "object") return Object.entries(node).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
  throw new Error(`${prefix} is neither text nor a group`);
}

const placeholders = (text: string) => [...text.matchAll(/\{[a-zA-Z_]+\}/g)].map((m) => m[0]).sort();

describe("S1.6: message catalogues (FR-15)", () => {
  const en = leaves(read("en"));
  const fr = leaves(read("fr"));

  it("French has exactly the keys English has", () => {
    expect(fr.map((l) => l.path).sort()).toEqual(en.map((l) => l.path).sort());
  });

  it("no string is empty", () => {
    for (const leaf of [...en, ...fr]) expect(leaf.value.trim().length, leaf.path).toBeGreaterThan(0);
  });

  it("French keeps the same placeholders as English", () => {
    const frByPath = new Map(fr.map((l) => [l.path, l.value]));
    for (const leaf of en) expect(placeholders(frByPath.get(leaf.path) ?? ""), leaf.path).toEqual(placeholders(leaf.value));
  });

  it("every namespace is a top-level group, so a route can load just its own", () => {
    for (const locale of ["en", "fr"]) {
      for (const [namespace, group] of Object.entries(read(locale))) {
        expect(typeof group, `${locale}.${namespace}`).toBe("object");
      }
    }
  });
});

describe("pickNamespaces", () => {
  const messages = { home: { title: "A" }, apply: { name: "B" }, admin: { menu: "C" } };

  it("keeps only the namespaces a client island asks for", () => {
    expect(pickNamespaces(messages, ["apply"])).toEqual({ apply: { name: "B" } });
    expect(pickNamespaces(messages, ["home", "apply"])).toEqual({ home: { title: "A" }, apply: { name: "B" } });
    expect(pickNamespaces(messages, [])).toEqual({});
  });

  it("throws on an unknown namespace, so a typo cannot ship an empty island", () => {
    expect(() => pickNamespaces(messages, ["aply"])).toThrow(/aply/);
    expect(() => pickNamespaces(messages, ["constructor"])).toThrow(/constructor/);
  });
});
