import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs helper with no type declarations
import { cpuStats, D1_PLACEHOLDER, drainJsonObjects, KV_PLACEHOLDER, markdownTable, parseSeedSha, patchWranglerConfig, quantile, workersDevUrl } from "../../scripts/ci/lib.mjs";

const KV_ID = "0123456789abcdef0123456789abcdef";
const D1_ID = "11111111-2222-4333-8444-555555555555";
const config = `{ "kv_namespaces": [{ "binding": "A", "id": "${KV_PLACEHOLDER}" }], "d1_databases": [{ "binding": "B", "database_id": "${D1_PLACEHOLDER}" }] }`;

describe("patchWranglerConfig", () => {
  it("fills both placeholders and leaves the rest untouched", () => {
    const out = patchWranglerConfig(config, { kvId: KV_ID, d1Id: D1_ID });
    expect(out).toContain(KV_ID);
    expect(out).toContain(D1_ID);
    expect(out).not.toContain("REPLACE_ME");
    expect(out).toContain('"binding": "A"');
  });

  it("refuses a config that has already been patched, so a stale config is never deployed silently", () => {
    const once = patchWranglerConfig(config, { kvId: KV_ID, d1Id: D1_ID });
    expect(() => patchWranglerConfig(once, { kvId: KV_ID, d1Id: D1_ID })).toThrow(/placeholder not found/);
  });

  it("refuses malformed ids", () => {
    expect(() => patchWranglerConfig(config, { kvId: "short", d1Id: D1_ID })).toThrow(/KV namespace id/);
    expect(() => patchWranglerConfig(config, { kvId: KV_ID, d1Id: "nope" })).toThrow(/D1 database id/);
    expect(() => patchWranglerConfig(config, { kvId: undefined, d1Id: D1_ID })).toThrow();
  });
});

describe("parseSeedSha", () => {
  const sha = "a".repeat(64);
  it("reads the sha256 line from the seed script output", () => {
    expect(parseSeedSha(`Image: 299.9 KB WebP\nsha256: ${sha}\nURL path: /media/${sha}.webp\n`)).toBe(sha);
  });
  it("does not accept a URL line or a short hash", () => {
    expect(() => parseSeedSha(`URL path: /media/${sha}.webp`)).toThrow();
    expect(() => parseSeedSha("sha256: abc123")).toThrow();
  });
});

describe("workersDevUrl", () => {
  it("builds the address", () => {
    expect(workersDevUrl("scollarly", "gimafolabit")).toBe("https://scollarly.gimafolabit.workers.dev");
  });
  it("refuses a missing subdomain or a suspicious name", () => {
    expect(() => workersDevUrl("scollarly", null)).toThrow(/no workers.dev subdomain/);
    expect(() => workersDevUrl("scollarly", "")).toThrow();
    expect(() => workersDevUrl("bad/name", "x")).toThrow();
    expect(() => workersDevUrl("scollarly", "evil.example.com/")).toThrow();
  });
});

describe("quantile and markdownTable", () => {
  it("computes nearest-rank quantiles and handles an empty list", () => {
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(quantile([], 0.5)).toBeNull();
  });

  it("renders PASS, FAIL and info and escapes pipes and newlines in cells", () => {
    const table = markdownTable([
      { name: "a | b", pass: true, detail: "ok" },
      { name: "c", pass: false, detail: { n: 1 } },
      { name: "d", pass: null, detail: "line1\nline2" },
    ]);
    const lines = table.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[2]).toContain("a \\| b");
    expect(lines[2]).toContain("PASS");
    expect(lines[3]).toContain("FAIL");
    expect(lines[3]).toContain('{"n":1}');
    expect(lines[4]).toContain("info");
    expect(lines[4]).not.toContain("\n");
  });
});

describe("drainJsonObjects (wrangler tail prints pretty-printed multi-line JSON)", () => {
  const event = (n: number) => JSON.stringify({ cpuTime: n, event: { request: { url: "https://x/{not-a-brace}" } }, note: 'has "quotes" and } braces' }, null, 4);

  it("extracts every complete object from pretty-printed output", () => {
    const { objects, rest } = drainJsonObjects(`${event(1)}\n${event(2)}\n`);
    expect(objects.map((o: string) => JSON.parse(o).cpuTime)).toEqual([1, 2]);
    expect(rest).toBe("");
  });

  it("keeps an unfinished object for the next chunk and finishes it when the rest arrives", () => {
    const whole = event(7);
    const cut = Math.floor(whole.length / 2);
    const first = drainJsonObjects(whole.slice(0, cut));
    expect(first.objects).toEqual([]);
    const second = drainJsonObjects(first.rest + whole.slice(cut));
    expect(second.objects.map((o: string) => JSON.parse(o).cpuTime)).toEqual([7]);
  });

  it("is not fooled by braces and escaped quotes inside strings", () => {
    const { objects } = drainJsonObjects('{"a":"}{\\"}","b":1}{"a":2}');
    expect(objects).toHaveLength(2);
    expect(JSON.parse(objects[0]).b).toBe(1);
  });

  it("ignores noise between objects and returns nothing for empty input", () => {
    expect(drainJsonObjects(`Successfully created tail\n${event(3)}`).objects).toHaveLength(1);
    expect(drainJsonObjects("").objects).toEqual([]);
  });
});

describe("cpuStats", () => {
  it("reports all samples and the samples after the warm-up separately", () => {
    const s = cpuStats([200, 150, 120, 4, 5, 6, 7, 8], 3);
    expect(s.all.n).toBe(8);
    expect(s.all.max).toBe(200);
    expect(s.warm.n).toBe(5);
    expect(s.warm.max).toBe(8);
    expect(s.warm.p50).toBe(6);
  });
  it("handles too few samples", () => {
    expect(cpuStats([1, 2], 3).warm.p95).toBeNull();
  });
});
