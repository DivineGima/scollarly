import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.fn();
const complete = vi.fn();
vi.mock("@/server/auth/session", () => ({
  startGoogleSignIn: (...args: unknown[]) => start(...args),
  completeSignIn: (...args: unknown[]) => complete(...args),
}));

import { handleSignIn } from "@/server/edge/sign-in";

const env = { NEON_AUTH_BASE_URL: "https://auth.example/neondb/auth", NEON_AUTH_COOKIE_SECRET: "s".repeat(32) } as CloudflareEnv;
const get = (path: string, method = "GET") => new Request(`https://scollarly.example${path}`, { method });

describe("handleSignIn", () => {
  beforeEach(() => {
    start.mockReset().mockResolvedValue(new Response(null, { status: 302 }));
    complete.mockReset().mockResolvedValue(new Response(null, { status: 302 }));
  });

  it("starts Google sign-in at /auth/start, returning to /auth/return", async () => {
    const response = await handleSignIn(get("/auth/start"), env);
    expect(response?.status).toBe(302);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[1]).toEqual({ baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET });
    expect(start.mock.calls[0]?.[2]).toBe("/auth/return");
  });

  it("finishes sign-in at /auth/return and goes on to /auth/landing, which chooses the page for the role", async () => {
    await handleSignIn(get("/auth/return?neon_auth_session_verifier=abc"), env);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[2]).toBe("/auth/landing");
  });

  it("carries a well-formed invite token through the whole trip, and drops anything else", async () => {
    const invite = "A".repeat(43);
    await handleSignIn(get(`/auth/start?invite=${invite}`), env);
    expect(start.mock.calls[0]?.[2]).toBe(`/auth/return?invite=${invite}`);
    await handleSignIn(get(`/auth/return?invite=${invite}&neon_auth_session_verifier=abc`), env);
    expect(complete.mock.calls[0]?.[2]).toBe(`/auth/landing?invite=${invite}`);

    start.mockClear();
    complete.mockClear();
    for (const bad of ["short", "A".repeat(44), "../../etc/passwd", `${"A".repeat(42)}+`]) {
      await handleSignIn(get(`/auth/start?invite=${encodeURIComponent(bad)}`), env);
      await handleSignIn(get(`/auth/return?invite=${encodeURIComponent(bad)}`), env);
    }
    expect(start.mock.calls.every((call) => call[2] === "/auth/return")).toBe(true);
    expect(complete.mock.calls.every((call) => call[2] === "/auth/landing")).toBe(true);
  });

  it("ignores every other path and every other method", () => {
    for (const path of ["/", "/auth", "/auth/start/x", "/api/auth/sign-in/social", "/admin/phase0"]) expect(handleSignIn(get(path), env), path).toBeNull();
    expect(handleSignIn(get("/auth/start", "POST"), env)).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});
