import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@/lib/hash";
import { errorResponse, isSameOrigin, jsonResponse, readCappedBytes, readJsonBody } from "@/lib/http";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://scollarly.co.in/api/v1/leads", { method: "POST", body, headers });

describe("readJsonBody", () => {
  it("parses valid JSON", async () => {
    expect(await readJsonBody(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("refuses a body over the cap, by declared length and by actual size", async () => {
    expect(await readJsonBody(post("{}", { "content-length": "5000" }), 100)).toEqual({ ok: false, reason: "too_large" });
    expect(await readJsonBody(post(JSON.stringify({ a: "x".repeat(200) })), 100)).toEqual({ ok: false, reason: "too_large" });
  });

  it("counts bytes, not characters", async () => {
    const body = JSON.stringify({ a: "é".repeat(60) }); // under 100 characters, over 100 bytes
    expect(await readJsonBody(post(body), 100)).toEqual({ ok: false, reason: "too_large" });
  });

  it("reports invalid JSON", async () => {
    expect(await readJsonBody(post("{not json"), 100)).toEqual({ ok: false, reason: "invalid_json" });
    expect(await readJsonBody(post(""), 100)).toEqual({ ok: false, reason: "invalid_json" });
  });
});

describe("a body with no declared length (chunked)", () => {
  const chunked = (chunks: string[]) => {
    const encoder = new TextEncoder();
    let read = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks[read++];
        if (next === undefined) controller.close();
        else controller.enqueue(encoder.encode(next));
      },
    });
    // No Content-Length is sent for a streamed body, so only counting the bytes as they arrive can stop it.
    return { request: new Request("https://scollarly.co.in/api/v1/leads", { method: "POST", body: stream, duplex: "half" } as RequestInit), pulled: () => read };
  };

  it("is refused as soon as it passes the cap, without reading the rest", async () => {
    const { request, pulled } = chunked(Array.from({ length: 50 }, () => "x".repeat(40)));
    expect(await readCappedBytes(request, 100)).toEqual({ ok: false });
    expect(pulled()).toBeLessThan(10);
  });

  it("is accepted and joined in order when it fits", async () => {
    const { request } = chunked(['{"a"', ":1}"]);
    expect(await readJsonBody(request, 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("an empty body is invalid JSON unless the caller says what it stands for", async () => {
    expect(await readJsonBody(post(""), 100, { emptyIs: {} })).toEqual({ ok: true, value: {} });
    expect(await readJsonBody(post("  \n"), 100, { emptyIs: {} })).toEqual({ ok: true, value: {} });
    expect(await readJsonBody(post(""), 100)).toEqual({ ok: false, reason: "invalid_json" });
  });
});

describe("isSameOrigin", () => {
  const req = (origin?: string) => new Request("https://scollarly.co.in/api/v1/leads", { headers: origin ? { origin } : {} });
  it("allows a missing Origin and the same origin", () => {
    expect(isSameOrigin(req())).toBe(true);
    expect(isSameOrigin(req("https://scollarly.co.in"))).toBe(true);
  });
  it("refuses any other origin, including look-alikes", () => {
    expect(isSameOrigin(req("https://evil.example"))).toBe(false);
    expect(isSameOrigin(req("https://scollarly.co.in.evil.example"))).toBe(false);
    expect(isSameOrigin(req("http://scollarly.co.in"))).toBe(false);
    expect(isSameOrigin(req("null"))).toBe(false);
  });
});

describe("response helpers", () => {
  it("uses the error envelope from architecture 8.1 and never caches", async () => {
    const res = errorResponse(400, "VALIDATION", "Check the fields.", "req-1", { fields: { name: "Required" } });
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "VALIDATION", message: "Check the fields.", fields: { name: "Required" } }, request_id: "req-1" });
  });

  it("omits fields when there are none, and passes extra headers such as Retry-After", async () => {
    const res = errorResponse(429, "RATE_LIMITED", "Slow down.", "req-2", { headers: { "Retry-After": "30" } });
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(((await res.json()) as { error: object }).error).not.toHaveProperty("fields");
  });

  it("jsonResponse sets JSON and no-store", () => {
    const res = jsonResponse({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("hashing helpers", () => {
  it("sha256Hex matches the known vector for an empty string and for 'abc'", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("canonicalJson ignores key order and undefined values but keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});
