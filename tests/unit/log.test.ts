import { afterEach, describe, expect, it, vi } from "vitest";
import { logError } from "@/server/log";

afterEach(() => vi.restoreAllMocks());

describe("logError: one structured line per server fault, with no message and no stack", () => {
  it("writes the request id, the route, the error class and a SQLSTATE code", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("req-1", "admin/leads", Object.assign(new Error("password authentication failed for user x, row (Amina, +237651232301)"), { code: "28P01" }));
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({ level: "error", requestId: "req-1", route: "admin/leads", error: "Error", code: "28P01" });
    expect(line).not.toContain("Amina");
    expect(line).not.toContain("password");
  });

  it("copes with a thrown value that is not an Error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("req-2", "events", "boom");
    logError("req-3", "events", null);
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({ error: "string" });
    expect(JSON.parse(String(spy.mock.calls[1]?.[0]))).toMatchObject({ error: "object" });
  });
});
