import { describe, expect, it, vi } from "vitest";
import { serveMedia, type ServeMediaDeps } from "@/modules/media/serve";
import type { MediaBlobResult } from "@/server/repositories/media";

const SHA = "a".repeat(64);
const blob = (over: Partial<MediaBlobResult> = {}): MediaBlobResult => ({ sha256: SHA, mime: "image/webp", bytes: 4, data: new Uint8Array([1, 2, 3, 4]), ...over });

function fakeCache() {
  const store = new Map<string, Response>();
  return {
    store,
    match: vi.fn(async (req: Request | string) => store.get(typeof req === "string" ? req : req.url)?.clone()),
    put: vi.fn(async (req: Request | string, res: Response) => void store.set(typeof req === "string" ? req : req.url, res)),
  };
}

function setup(over: Partial<ServeMediaDeps> = {}) {
  const cache = fakeCache();
  const pending: Promise<unknown>[] = [];
  const loadBlob = vi.fn(async (_sha: string): Promise<MediaBlobResult | null> => blob());
  const deps: ServeMediaDeps = {
    hashParam: `${SHA}.webp`,
    requestUrl: "https://scollarly.co.in/media/x?utm=1",
    cache,
    loadBlob,
    waitUntil: (p) => void pending.push(p),
    ...over,
  };
  return { deps, cache, loadBlob, flush: () => Promise.all(pending) };
}

describe("serveMedia", () => {
  it("serves a miss from the database with immutable cache headers and stores it in the Cache API", async () => {
    const { deps, loadBlob, cache, flush } = setup();
    const res = await serveMedia(deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(loadBlob).toHaveBeenCalledTimes(1);
    await flush();
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("makes NO database access on a cache hit (S0.5 gate)", async () => {
    const { deps, loadBlob, flush } = setup();
    await serveMedia(deps);
    await flush();
    loadBlob.mockClear();
    const second = await serveMedia(deps);
    expect(second.status).toBe(200);
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it("uses one canonical cache key whatever the extension or query string", async () => {
    const { deps, cache, loadBlob, flush } = setup();
    await serveMedia(deps);
    await flush();
    await serveMedia({ ...deps, hashParam: SHA, requestUrl: "https://scollarly.co.in/media/other?x=2" });
    expect(loadBlob).toHaveBeenCalledTimes(1);
    expect([...cache.store.keys()]).toEqual([`https://scollarly.co.in/media/${SHA}.webp`]);
  });

  it("returns 404 without touching the cache or database for a malformed hash", async () => {
    for (const hashParam of ["", "abc", "A".repeat(64), `${SHA}.png`, `${SHA}/../x`, `${"a".repeat(63)}g.webp`, "../etc/passwd"]) {
      const { deps, loadBlob, cache } = setup({ hashParam });
      const res = await serveMedia(deps);
      expect(res.status).toBe(404);
      expect(loadBlob).not.toHaveBeenCalled();
      expect(cache.match).not.toHaveBeenCalled();
    }
  });

  it("returns an uncached 404 for an unknown or archived image", async () => {
    const { deps, cache } = setup({ loadBlob: async () => null });
    const res = await serveMedia(deps);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("refuses to serve anything that is not WebP", async () => {
    const { deps } = setup({ loadBlob: async () => blob({ mime: "image/svg+xml" }) });
    expect((await serveMedia(deps)).status).toBe(404);
  });
});
