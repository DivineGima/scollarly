import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isTrustedSession } from "@/server/auth/trusted-session";
import { isPublicPagePath, PUBLIC_PAGE_PATHS } from "@/lib/public-paths";
import * as fastPath from "@/server/edge/fast-path";

describe("review fix 1 and 2: one trust rule", () => {
  it("trusts a verified email for any role and an unverified email for a student only", () => {
    expect(isTrustedSession({ emailVerified: true, role: "owner" })).toBe(true);
    expect(isTrustedSession({ emailVerified: true, role: "admin" })).toBe(true);
    expect(isTrustedSession({ emailVerified: false, role: "student" })).toBe(true);
    expect(isTrustedSession({ emailVerified: false, role: "admin" })).toBe(false);
    expect(isTrustedSession({ emailVerified: false, role: "owner" })).toBe(false);
    // An unknown stored role is treated as a student elsewhere (`isRole`), but never as staff here.
    expect(isTrustedSession({ emailVerified: false, role: "superuser" })).toBe(false);
  });
});

describe("review fix 8: the public path list lives in lib and fast-path re-exports it", () => {
  it("is the same list on both sides", () => {
    expect(fastPath.PUBLIC_PAGE_PATHS).toBe(PUBLIC_PAGE_PATHS);
    expect(fastPath.isPublicPagePath("/universities/alpha")).toBe(isPublicPagePath("/universities/alpha"));
  });

  it("is not imported from edge code by client modules", () => {
    for (const file of ["src/modules/gate/next.ts", "src/components/auth/next-aware-link.tsx", "src/components/auth/email-password-form.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/server\/edge/);
    }
  });
});

describe("review fix 10: one Neon Auth config helper", () => {
  it("is not copied into the edge functions", () => {
    for (const file of ["src/server/edge/sign-in.ts", "src/server/edge/password-auth.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/const configOf/);
    }
  });
});

describe("review fix 3: the lead endpoint limits before it looks the session up", () => {
  const resolveSession = vi.fn();
  const createLead = vi.fn();
  const limiter = vi.fn();

  beforeEach(() => {
    resolveSession.mockReset();
    createLead.mockReset();
    limiter.mockReset();
    vi.resetModules();
  });

  async function load() {
    vi.doMock("@/server/repositories/session-lookup", () => ({ resolveSession: (...a: unknown[]) => resolveSession(...a) }));
    vi.doMock("@/modules/leads/service", () => ({ createLead: (...a: unknown[]) => createLead(...a) }));
    vi.doMock("@/server/db/runtime", () => ({ getDb: () => ({}) }));
    vi.doMock("@/server/repositories/lead-intake", () => ({ insertLead: vi.fn() }));
    vi.doMock("@/server/security/rate-limit", () => ({ createDurableObjectLimiter: () => limiter, limiterKey: async (parts: { route: string }) => parts.route }));
    vi.doMock("@/server/edge/settings-cache", () => ({ cachedSlaSettings: vi.fn() }));
    return (await import("@/server/edge/leads")).handleLeadPost;
  }

  const env = { RATE_LIMITER: {}, RATE_LIMIT_SECRET: "s", DATABASE_URL: "postgres://x", TURNSTILE_SECRET_KEY: "t", PHASE0_PROBE_TOKEN: "probe" } as unknown as CloudflareEnv;
  const request = () =>
    new Request("https://scollarly.test/api/v1/leads", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "11111111-1111-4111-8111-111111111111", cookie: "__Secure-neon-auth.session_token=abcdefghijklmnop1234567890.sig" },
      body: JSON.stringify({ name: "Ama" }),
    });

  it("answers 429 and never queries the database when the caller is over the gate limit", async () => {
    const handleLeadPost = await load();
    limiter.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const response = await handleLeadPost(request(), env);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("lets an unverified student through, and refuses an unverified admin", async () => {
    const handleLeadPost = await load();
    limiter.mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0 });
    createLead.mockResolvedValue({ ok: true, replayed: false, status: 201, ref: "SC-AAAAA-AAAAB" });
    resolveSession.mockResolvedValue({ userId: "u", role: "student", emailVerified: false, accountConfirmed: true });
    expect((await handleLeadPost(request(), env)).status).toBe(201);
    resolveSession.mockResolvedValue({ userId: "u", role: "admin", emailVerified: false, accountConfirmed: true });
    expect((await handleLeadPost(request(), env)).status).toBe(401);
  });
});
