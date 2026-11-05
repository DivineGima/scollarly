import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The code review of Stage 0 to S15.7 (plan: review-this-code-as-imperative-clock): one test group per fixed issue that has pure or mockable
 * logic. The database side of the other fixes is in tests/integration/review-s15-fixes.test.ts.
 */

// ---- 1. Sign-out clears a queued application ---------------------------------------------------------------------------------------
const queue = vi.hoisted(() => ({ items: [] as { key: string; kind?: string }[] }));
vi.mock("@/offline/lead-queue", () => ({
  listLeads: async () => [...queue.items],
  removeLead: async (key: string) => void (queue.items = queue.items.filter((i) => i.key !== key)),
}));
vi.mock("@/offline/db", () => ({ offlineDb: async () => ({ clear: async () => undefined }) }));

describe("clearOnboardingOnDevice", () => {
  beforeEach(() => {
    queue.items = [{ key: "a", kind: "onboarding" }, { key: "b", kind: "application" }, { key: "c" }, { key: "d", kind: "lead" }];
  });

  it("forgets a queued questionnaire and a queued application, so the next person on the phone cannot send them as themselves", async () => {
    const { clearOnboardingOnDevice } = await import("@/offline/onboarding-draft");
    await clearOnboardingOnDevice();
    expect(queue.items.map((i) => i.key)).toEqual(["c", "d"]);
  });
});

// ---- 3. Restoring counts never writes more than 128 pairs --------------------------------------------------------------------------
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

function fakeStorage() {
  const data = new Map<string, number>();
  return {
    data,
    get: async (keys: string | string[]) => (Array.isArray(keys) ? new Map(keys.filter((k) => data.has(k)).map((k) => [k, data.get(k) as number])) : data.get(keys)),
    put: async (entries: Record<string, number> | string, value?: number) => {
      if (typeof entries === "string") return void data.set(entries, value as number);
      if (Object.keys(entries).length > 128) throw new Error("storage.put: more than 128 pairs");
      for (const [k, v] of Object.entries(entries)) data.set(k, v);
    },
  };
}

describe("Collector.restoreAggregates", () => {
  it("puts back 300 distinct counts after a failed rollup, in writes of at most 128 pairs", async () => {
    const { Collector } = await import("../../worker/collector");
    const storage = fakeStorage();
    const collector = new (Collector as unknown as new (ctx: unknown, env: unknown) => InstanceType<typeof Collector>)({ storage }, {});
    // The base class is stubbed, so the context is attached the way the real one would.
    (collector as unknown as { ctx: unknown }).ctx = { storage };
    const counts = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`agg:2026-11-05:page_view:CM:u:${i}`, 2]));
    await collector.restoreAggregates(counts);
    expect([...storage.data.keys()].filter((k) => k.startsWith("agg:"))).toHaveLength(300);
    expect(storage.data.get("agg_key_count")).toBe(300);
  });
});

// ---- 6. Concurrent settings misses share one read ----------------------------------------------------------------------------------
describe("cachedSettings", () => {
  it("reads once for requests that miss together, and tries again after a failed read", async () => {
    vi.resetModules();
    let reads = 0;
    let fail = true;
    vi.doMock("@/server/repositories/settings-read", () => ({
      readSettings: async () => {
        reads += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (fail) throw new Error("neon down");
        return { collect_page_views: true };
      },
    }));
    const { cachedSettings, resetSettingsCache } = await import("@/server/edge/settings-cache");
    resetSettingsCache();
    const db = {} as never;
    const settled = await Promise.allSettled([cachedSettings(db, "k", 1), cachedSettings(db, "k", 1), cachedSettings(db, "k", 1)]);
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect(reads).toBe(1);
    fail = false;
    const values = await Promise.all([cachedSettings(db, "k", 2), cachedSettings(db, "k", 2)]);
    expect(values[0]).toEqual({ collect_page_views: true });
    expect(reads).toBe(2);
  });
});
