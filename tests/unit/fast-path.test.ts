import { describe, expect, it, vi } from "vitest";
import { cacheKey, classify, isStorablePage, PAGE_EDGE_TTL_SECONDS, serveFastPath, toEdgeCopy } from "@/server/edge/fast-path";

const url = (path: string) => new URL(`https://scollarly.example${path}`);
const SHA = "a".repeat(64);
const html = (init: ResponseInit = {}) => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });

describe("classify: only public, cookie-free GETs are eligible", () => {
  it("accepts the public pages and content-hashed images", () => {
    expect(classify("GET", url("/"), false)).toBe("page");
    expect(classify("GET", url("/offline"), false)).toBe("page");
    // The sign-in and sign-out pages are the same HTML for everyone: the reason for a return (?error=) is read in the browser.
    expect(classify("GET", url("/sign-in?error=failed"), false)).toBe("page");
    expect(classify("GET", url("/sign-out"), false)).toBe("page");
    expect(classify("GET", url("/sign-in"), true)).toBeNull(); // a signed-in visitor is not served from the shared cache
    // Stage 3: every public page, and the slug pages of universities and posts.
    for (const path of ["/universities", "/fees", "/campus-tours", "/process", "/visa", "/faq", "/about", "/blog", "/contact", "/apply", "/privacy", "/terms", "/universities/jain-university", "/blog/how-to-apply-2026"]) {
      expect(classify("GET", url(path), false), path).toBe("page");
    }
    expect(classify("GET", url(`/media/${SHA}.webp`), false)).toBe("media");
    expect(classify("GET", url(`/media/${SHA}`), true)).toBe("media");
  });

  it("never touches private areas, the API, build assets or unknown paths", () => {
    for (const path of ["/admin", "/admin/phase0", "/me", "/me/phase0", "/api/v1/health", "/api/auth/session", "/_next/static/x.js", "/two-factor/enrol", "/accept-invite/abc", "/auth/landing", "/universities/", "/universities/Bad_Slug", "/universities/a/b", "/blog/", "/apply/x", "/media/short.webp", `/media/${SHA}.png`, `/media/${SHA}/x`]) {
      expect(classify("GET", url(path), false), path).toBeNull();
    }
  });

  it("refuses non-GET methods", () => {
    for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"]) expect(classify(method, url("/"), false)).toBeNull();
  });

  it("refuses a page request that carries cookies (a signed-in visitor), so private variants cannot be mixed in", () => {
    expect(classify("GET", url("/"), true)).toBeNull();
  });
});

describe("cacheKey", () => {
  it("ignores the query string for pages", () => {
    expect(cacheKey(url("/?utm_source=x&m=1"), "page").url).toBe("https://scollarly.example/");
  });
  it("uses one canonical key per image, with or without the extension", () => {
    expect(cacheKey(url(`/media/${SHA}`), "media").url).toBe(`https://scollarly.example/media/${SHA}.webp`);
    expect(cacheKey(url(`/media/${SHA}.webp?x=1`), "media").url).toBe(`https://scollarly.example/media/${SHA}.webp`);
  });
});

describe("what may be stored", () => {
  it("stores a plain 200 HTML page", () => expect(isStorablePage(html())).toBe(true));
  it("does not store errors, redirects, non-HTML, or anything that sets a cookie", () => {
    expect(isStorablePage(html({ status: 404 }))).toBe(false);
    expect(isStorablePage(html({ status: 500 }))).toBe(false);
    expect(isStorablePage(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))).toBe(false);
    expect(isStorablePage(html({ headers: { "content-type": "text/html", "set-cookie": "a=b" } }))).toBe(false);
  });
  it("gives the stored copy a short, explicit lifetime", () => {
    const copy = toEdgeCopy(html({ headers: { "content-type": "text/html", "cache-control": "s-maxage=31536000" } }));
    expect(copy.headers.get("cache-control")).toBe(`public, max-age=0, s-maxage=${PAGE_EDGE_TTL_SECONDS}`);
    expect(PAGE_EDGE_TTL_SECONDS).toBeLessThanOrEqual(60);
  });
});

function fakeCache() {
  const store = new Map<string, Response>();
  return {
    store,
    match: vi.fn(async (req: Request | string) => store.get(typeof req === "string" ? req : req.url)?.clone()),
    put: vi.fn(async (req: Request | string, res: Response) => void store.set(typeof req === "string" ? req : req.url, res)),
  };
}

describe("serveFastPath", () => {
  const request = (path: string) => new Request(`https://scollarly.example${path}`);

  it("on a page miss runs Next.js once, returns its response unchanged, and stores a short-lived copy", async () => {
    const cache = fakeCache();
    const pending: Promise<unknown>[] = [];
    const next = vi.fn(async () => html({ headers: { "content-type": "text/html", "cache-control": "s-maxage=31536000" } }));
    const res = await serveFastPath(request("/?x=1"), "page", { cache, next, waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers.get("cache-control")).toBe("s-maxage=31536000");
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.store.get("https://scollarly.example/")?.headers.get("cache-control")).toContain("s-maxage=30");
  });

  it("on a hit never runs Next.js (this is the whole point)", async () => {
    const cache = fakeCache();
    const pending: Promise<unknown>[] = [];
    const next = vi.fn(async () => html());
    await serveFastPath(request("/"), "page", { cache, next, waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    next.mockClear();
    const res = await serveFastPath(request("/?utm=2"), "page", { cache, next, waitUntil: () => undefined });
    expect(res.status).toBe(200);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not store a failing page, and still returns it", async () => {
    const cache = fakeCache();
    const res = await serveFastPath(request("/"), "page", { cache, next: async () => html({ status: 500 }), waitUntil: () => undefined });
    expect(res.status).toBe(500);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("for an image miss falls through without storing (the image route stores the bytes itself)", async () => {
    const cache = fakeCache();
    const next = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } }));
    await serveFastPath(request(`/media/${SHA}.webp`), "media", { cache, next, waitUntil: () => undefined });
    expect(next).toHaveBeenCalledTimes(1);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("serves an image hit from the same key the image route writes", async () => {
    const cache = fakeCache();
    cache.store.set(`https://scollarly.example/media/${SHA}.webp`, new Response(new Uint8Array([9]), { headers: { "content-type": "image/webp" } }));
    const next = vi.fn();
    const res = await serveFastPath(request(`/media/${SHA}`), "media", { cache, next, waitUntil: () => undefined });
    expect(next).not.toHaveBeenCalled();
    expect(res.headers.get("content-type")).toBe("image/webp");
  });
});
