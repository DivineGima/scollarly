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

  it("finishes sign-in at /auth/return and lands on the Stage 0 student page", async () => {
    await handleSignIn(get("/auth/return?neon_auth_session_verifier=abc"), env);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[2]).toBe("/me/phase0");
  });

  it("ignores every other path and every other method", () => {
    for (const path of ["/", "/auth", "/auth/start/x", "/api/auth/sign-in/social", "/admin/phase0"]) expect(handleSignIn(get(path), env), path).toBeNull();
    expect(handleSignIn(get("/auth/start", "POST"), env)).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});
