import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/runtime", () => ({ getDb: () => ({}) }));
vi.mock("@/server/repositories/rollup", () => ({
  saveAggregateRows: vi.fn(async () => undefined),
  rollRawEvents: vi.fn(async () => ({ counted: 0, purged: 0 })),
}));

import { runScheduled } from "@/server/edge/cron";

/** A Worker environment whose collector is the given stub. */
const envWith = (stub: Record<string, unknown>) =>
  ({ COLLECTOR: { idFromName: () => "id", get: () => stub } }) as unknown as CloudflareEnv;

describe("the daily job", () => {
  it("still rolls the day up when the Stage 0 'it ran' marker cannot be written", async () => {
    const drain = vi.fn(async () => ({}));
    const stub = { recordCron: vi.fn(async () => Promise.reject(new Error("storage hiccup"))), drainAggregates: drain, restoreAggregates: vi.fn(async () => undefined) };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await runScheduled(envWith(stub), Date.now());
    expect(drain).toHaveBeenCalledTimes(1);
    expect(result.failed).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    // The log line names the step and carries no event, key or identifier.
    expect(String(error.mock.calls[0]?.[0])).toContain("recordCron");
  });
});
