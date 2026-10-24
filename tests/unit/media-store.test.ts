import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/hash";
import { createMediaStore, MAX_IMAGE_BYTES, MediaStoreError, mediaKey } from "@/server/media/store";

const config = {
  endpoint: "https://br-test.storage.c-7.eu-central-1.aws.neon.tech/",
  region: "eu-central-1",
  accessKeyId: "AKIATESTTESTTEST",
  secretAccessKey: "secret-secret-secret-secret-secret-1234",
};
const bytes = new TextEncoder().encode("a tiny pretend image");

describe("keys and URLs", () => {
  it("names objects by content hash and builds a path-style public URL", async () => {
    const sha = await sha256Hex(bytes);
    expect(mediaKey(sha)).toBe(`${sha}.webp`);
    expect(createMediaStore(config).publicUrl(sha)).toBe(`https://br-test.storage.c-7.eu-central-1.aws.neon.tech/images/${sha}.webp`);
  });

  it("refuses anything that is not a SHA-256 hex hash (no path tricks)", () => {
    for (const bad of ["", "abc", "../etc/passwd", `${"a".repeat(63)}/`, "A".repeat(64), `${"a".repeat(64)}.webp`]) {
      expect(() => mediaKey(bad), bad).toThrow(MediaStoreError);
    }
  });
});

describe("get: a plain fetch of the public object, with no credential", () => {
  it("returns the response for an existing image and sends no authorisation", async () => {
    const sha = await sha256Hex(bytes);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } }));
    const response = await createMediaStore(config, fetchImpl as unknown as typeof fetch).get(sha);
    expect(response?.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toContain(`/images/${sha}.webp`);
    expect(JSON.stringify(init ?? {})).not.toMatch(/authorization/i);
  });

  it("returns null for a missing object (404, or 403 on a store that hides missing keys)", async () => {
    const sha = await sha256Hex(bytes);
    for (const status of [404, 403]) {
      const store = createMediaStore(config, (async () => new Response("no", { status })) as typeof fetch);
      expect(await store.get(sha), String(status)).toBeNull();
    }
  });

  it("throws on a server error and when storage is unreachable, without leaking details", async () => {
    const sha = await sha256Hex(bytes);
    await expect(createMediaStore(config, (async () => new Response("boom", { status: 500 })) as typeof fetch).get(sha)).rejects.toMatchObject({ name: "MediaStoreError", status: 500 });
    const unreachable = createMediaStore(config, (async () => {
      throw new TypeError("fetch failed: secret.internal.host");
    }) as typeof fetch);
    await expect(unreachable.get(sha)).rejects.toThrow("Storage is not reachable");
    await expect(unreachable.get(sha)).rejects.not.toThrow(/secret\.internal/);
  });

  it("refuses an object that claims to be larger than the cap", async () => {
    const sha = await sha256Hex(bytes);
    const store = createMediaStore(config, (async () => new Response("x", { status: 200, headers: { "content-length": String(MAX_IMAGE_BYTES + 1) } })) as typeof fetch);
    await expect(store.get(sha)).rejects.toThrow("larger than the allowed size");
  });
});

describe("put: a signed S3 PutObject of bytes that match their own hash", () => {
  it("signs the request (AWS SigV4) and uploads to the hash key with immutable headers", async () => {
    const sha = await sha256Hex(bytes);
    const seen: { url: string; headers: Headers; method: string }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      seen.push({ url: request.url, headers: request.headers, method: request.method });
      return new Response(null, { status: 200 });
    });
    // aws4fetch uses the global fetch, so stub it for this call.
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await createMediaStore(config).put(sha, bytes);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("PUT");
    expect(seen[0]?.url).toContain(`/images/${sha}.webp`);
    expect(seen[0]?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATESTTESTTEST\/\d{8}\/eu-central-1\/s3\/aws4_request/);
    expect(seen[0]?.headers.get("content-type")).toBe("image/webp");
    expect(seen[0]?.headers.get("cache-control")).toContain("immutable");
  });

  it("refuses bytes whose hash is not the key (the store is content-addressed), before any request", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await expect(createMediaStore(config).put("a".repeat(64), bytes)).rejects.toThrow("does not match its hash");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an empty or oversized image", async () => {
    const store = createMediaStore(config);
    await expect(store.put(await sha256Hex(new Uint8Array()), new Uint8Array())).rejects.toThrow("outside the allowed range");
    await expect(store.put("b".repeat(64), new Uint8Array(MAX_IMAGE_BYTES + 1))).rejects.toThrow("outside the allowed range");
  });

  it("reports a failed write without leaking the response body", async () => {
    const sha = await sha256Hex(bytes);
    vi.stubGlobal("fetch", async () => new Response("<Error>secret detail</Error>", { status: 403 }));
    try {
      await expect(createMediaStore(config).put(sha, bytes)).rejects.toMatchObject({ message: "Storage write failed", status: 403 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("has no delete or overwrite method (decision D17)", () => {
    expect(Object.keys(createMediaStore(config)).sort()).toEqual(["get", "publicUrl", "put"]);
  });
});
