import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSession = vi.fn();
const createLead = vi.fn();

vi.mock("@/server/repositories/session-lookup", () => ({ resolveSession: (...args: unknown[]) => resolveSession(...args) }));
vi.mock("@/modules/leads/service", () => ({ createLead: (...args: unknown[]) => createLead(...args) }));
vi.mock("@/server/db/runtime", () => ({ getDb: () => ({}) }));
const tokenHasApplication = vi.fn();
vi.mock("@/server/repositories/lead-intake", () => ({ insertLead: vi.fn(), tokenHasApplication: (...args: unknown[]) => tokenHasApplication(...args) }));
vi.mock("@/server/security/rate-limit", () => ({ createDurableObjectLimiter: () => async () => ({ allowed: true }), limiterKey: async () => "k" }));
vi.mock("@/server/edge/settings-cache", () => ({ cachedSlaSettings: vi.fn() }));

import { handleLeadPost } from "@/server/edge/leads";

const env = { RATE_LIMITER: {}, RATE_LIMIT_SECRET: "s", DATABASE_URL: "postgres://x", TURNSTILE_SECRET_KEY: "t", PHASE0_PROBE_TOKEN: "probe" } as unknown as CloudflareEnv;

function post(headers: Record<string, string> = {}): Request {
  return new Request("https://scollarly.test/api/v1/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "11111111-1111-4111-8111-111111111111", ...headers },
    body: JSON.stringify({ name: "Ama" }),
  });
}

const COOKIE = { cookie: "__Secure-neon-auth.session_token=abcdefghijklmnop1234567890.sig" };

describe("S14.3: the lead endpoint is the lock behind every gated button (PRD_3 F20)", () => {
  beforeEach(() => {
    resolveSession.mockReset();
    createLead.mockReset();
    tokenHasApplication.mockReset();
    tokenHasApplication.mockResolvedValue(false);
    createLead.mockResolvedValue({ ok: true, replayed: false, status: 201, ref: "SC-AAAAA-AAAAB" });
  });

  it("refuses a request with no session cookie, before any database call", async () => {
    const response = await handleLeadPost(post(), env);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
    expect(resolveSession).not.toHaveBeenCalled();
    expect(createLead).not.toHaveBeenCalled();
  });

  it("refuses a cookie that names no live session", async () => {
    resolveSession.mockResolvedValue(null);
    const response = await handleLeadPost(post(COOKIE), env);
    expect(response.status).toBe(401);
    expect(createLead).not.toHaveBeenCalled();
  });

  it("refuses an account that has not been confirmed", async () => {
    resolveSession.mockResolvedValue({ userId: "u", role: "student", emailVerified: true, accountConfirmed: false });
    const response = await handleLeadPost(post(COOKIE), env);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("ACCOUNT_NOT_CONFIRMED");
    expect(createLead).not.toHaveBeenCalled();
  });

  it("answers 503, not a false refusal, when the session lookup itself fails", async () => {
    resolveSession.mockRejectedValue(new Error("db down"));
    const response = await handleLeadPost(post(COOKIE), env);
    expect(response.status).toBe(503);
    expect(createLead).not.toHaveBeenCalled();
  });

  it("refuses a second application from a student who already has one (S15.3, one application per account)", async () => {
    resolveSession.mockResolvedValue({ userId: "u", role: "student", emailVerified: true, accountConfirmed: true, onboardingDone: true });
    tokenHasApplication.mockResolvedValue(true);
    const response = await handleLeadPost(post(COOKIE), env);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("ALREADY_APPLIED");
    expect(createLead).not.toHaveBeenCalled();
  });

  it("answers 503, not a false refusal or a second lead, when the guard itself fails", async () => {
    resolveSession.mockResolvedValue({ userId: "u", role: "student", emailVerified: true, accountConfirmed: true, onboardingDone: true });
    tokenHasApplication.mockRejectedValue(new Error("db down"));
    const response = await handleLeadPost(post(COOKIE), env);
    expect(response.status).toBe(503);
    expect(createLead).not.toHaveBeenCalled();
  });

  it("does not ask the guard about staff: only a student has an application of their own to protect", async () => {
    resolveSession.mockResolvedValue({ userId: "a", role: "admin", emailVerified: true, accountConfirmed: true, onboardingDone: false });
    const response = await handleLeadPost(post(COOKIE), env);
    expect(response.status).toBe(201);
    expect(tokenHasApplication).not.toHaveBeenCalled();
  });

  it("lets a confirmed account through to the lead rules", async () => {
    resolveSession.mockResolvedValue({ userId: "u", role: "student", emailVerified: true, accountConfirmed: true });
    const response = await handleLeadPost(post(COOKIE), env);
    expect(response.status).toBe(201);
    expect(createLead).toHaveBeenCalledTimes(1);
  });
});
