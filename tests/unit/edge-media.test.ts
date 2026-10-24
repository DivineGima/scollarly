import { describe, expect, it, vi } from "vitest";
import { IMMUTABLE_HEADERS, serveMedia } from "@/server/edge/media";
import { MediaStoreError } from "@/server/media/store";

const SHA = "c".repeat(64);
const URL_ = `https://scollarly.example/media/${SHA}.webp`;

function deps(over: { stored?: Response | null | Error; cached?: Response | undefined } = {}) {
  const put = vi.fn(async () => undefined);
  const get = vi.fn(async () => {
    if (over.stored instanceof Error) throw over.stored;
    return over.stored === undefined ? new Response("bytes", { status: 200 }) : over.stored;
  });
  const waitUntil = vi.fn();
  return {
    put,
    get,
    waitUntil,
    args: (hashParam: string) => ({
      hashParam,
      requestUrl: URL_,
      cache: { match: vi.fn(async () => over.cached), put },
      store: { get },
      waitUntil,
    }),
  };
}

describe("serveMedia (the cache-miss path, run in the Worker entry)", () => {
  it("reads the image from storage, answers with immutable headers and stores a copy", async () => {
    const d = deps();
    const response = await serveMedia(d.args(`${SHA}.webp`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("bytes");
    for (const [name, value] of Object.entries(IMMUTABLE_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(d.get).toHaveBeenCalledWith(SHA);
    expect(d.waitUntil).toHaveBeenCalledTimes(1);
    expect(d.put).toHaveBeenCalledTimes(1);
  });

  it("accepts the hash with or without the extension", async () => {
    expect((await serveMedia(deps().args(SHA))).status).toBe(200);
  });

  it("returns a cached copy without touching storage", async () => {
    const d = deps({ cached: new Response("from cache") });
    const response = await serveMedia(d.args(SHA));
    expect(await response.text()).toBe("from cache");
    expect(d.get).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed hash, without touching the cache or storage", async () => {
    const d = deps();
    for (const bad of ["short", "../x", `${SHA}x`, SHA.toUpperCase(), `${SHA}.png`]) {
      const response = await serveMedia(d.args(bad));
      expect(response.status, bad).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(d.get).not.toHaveBeenCalled();
  });

  it("answers 404, uncached, for a hash that is not in storage", async () => {
    const d = deps({ stored: null });
    const response = await serveMedia(d.args(SHA));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(d.put).not.toHaveBeenCalled();
  });

  it("answers 502, uncached, when storage fails, and never caches the failure", async () => {
    const d = deps({ stored: new MediaStoreError("Storage read failed", 500) });
    const response = await serveMedia(d.args(SHA));
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(d.put).not.toHaveBeenCalled();
  });
});
