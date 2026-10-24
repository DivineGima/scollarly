import { describe, expect, it, vi } from "vitest";
import { type Actor, AuthError, mintActor, type Role, STEP_UP_WINDOW_MS } from "@/server/auth/actor";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { classifyMutation, denyAccess, handleMutation, type Mutation, type MutationDeps } from "@/server/edge/mutations";

const NOW = new Date("2026-10-24T12:00:00Z");

const actorOf = (storedRole: Role, over: { role?: Role; stepUpAgoMs?: number | null } = {}): Actor =>
  mintActor({
    userId: `user-${storedRole}`,
    sessionId: "s1",
    storedRole,
    role: over.role ?? storedRole,
    twoFactorVerifiedAt: over.stepUpAgoMs === undefined || over.stepUpAgoMs === null ? null : new Date(NOW.getTime() - over.stepUpAgoMs),
  });

describe("classifyMutation", () => {
  const url = (path: string) => new URL(`https://x.example${path}`);
  it("recognises POST /api/v1/<area>/<operation> for the four areas, operation names with dots", () => {
    expect(classifyMutation("POST", url("/api/v1/admin/team.invite"))).toEqual({ area: "admin", operation: "team.invite" });
    expect(classifyMutation("POST", url("/api/v1/auth/twoFactor.verify"))).toEqual({ area: "auth", operation: "twoFactor.verify" });
    expect(classifyMutation("POST", url("/api/v1/me/student.requestLink"))).toEqual({ area: "me", operation: "student.requestLink" });
    expect(classifyMutation("POST", url("/api/v1/invites/check"))).toEqual({ area: "invites", operation: "check" });
  });
  it("ignores other methods, other areas, lookalikes and extra segments", () => {
    for (const [method, path] of [
      ["GET", "/api/v1/admin/team.invite"],
      ["POST", "/api/v1/leads"],
      ["POST", "/api/v1/other/x"],
      ["POST", "/api/v1/admin/a/b"],
      ["POST", "/api/v1/admin/.hidden"],
      ["POST", "/api/v1/admin/1abc"],
      ["POST", "/api/v1/admin/"],
      ["POST", "/x/api/v1/admin/team.invite"],
    ] as const) {
      expect(classifyMutation(method, url(path)), `${method} ${path}`).toBeNull();
    }
  });
});

describe("denyAccess: the question each operation asks of the facade", () => {
  it("public: anyone; signed-in: needs a session", () => {
    expect(denyAccess({ kind: "public" }, null, NOW)).toBeNull();
    expect(denyAccess({ kind: "signed-in" }, null, NOW)?.status).toBe(401);
    expect(denyAccess({ kind: "signed-in" }, actorOf("student"), NOW)).toBeNull();
  });

  it("stored-owner: the owner account, with or without a 2FA check; nobody else, an admin included", () => {
    const access = { kind: "stored-owner" } as const;
    expect(denyAccess(access, actorOf("owner", { role: "student" }), NOW)).toBeNull(); // not yet verified: still the owner's own 2FA page
    expect(denyAccess(access, actorOf("owner", { stepUpAgoMs: 0 }), NOW)).toBeNull();
    expect(denyAccess(access, actorOf("admin"), NOW)?.status).toBe(403);
    expect(denyAccess(access, actorOf("student"), NOW)?.status).toBe(403);
    expect(denyAccess(access, null, NOW)?.status).toBe(401);
  });

  it("role: uses the effective role, so an owner without 2FA cannot do admin or owner work", () => {
    expect(denyAccess({ kind: "role", role: "admin" }, actorOf("admin"), NOW)).toBeNull();
    expect(denyAccess({ kind: "role", role: "admin" }, actorOf("owner", { stepUpAgoMs: 0 }), NOW)).toBeNull();
    expect(denyAccess({ kind: "role", role: "admin" }, actorOf("owner", { role: "student" }), NOW)?.status).toBe(403);
    expect(denyAccess({ kind: "role", role: "owner" }, actorOf("admin"), NOW)?.status).toBe(403);
  });

  it("role with step-up: allowed for exactly 10 minutes after a 2FA check, then asks again", () => {
    const access = { kind: "role", role: "owner", stepUp: true } as const;
    expect(denyAccess(access, actorOf("owner", { stepUpAgoMs: 0 }), NOW)).toBeNull();
    expect(denyAccess(access, actorOf("owner", { stepUpAgoMs: STEP_UP_WINDOW_MS }), NOW)).toBeNull();
    expect(denyAccess(access, actorOf("owner", { stepUpAgoMs: STEP_UP_WINDOW_MS + 1 }), NOW)).toMatchObject({ status: 403, code: "STEP_UP_REQUIRED" });
    expect(denyAccess(access, actorOf("owner", { role: "student" }), NOW)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("handleMutation", () => {
  const env = { db: {}, ownerEmail: "", totpKey: "", now: () => NOW } as unknown as EndpointEnv;

  function setup(over: { actor?: Actor | null; mutation?: Partial<Mutation>; checkFails?: boolean; allowed?: boolean } = {}) {
    const handle = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const checkSession = vi.fn(async () => {
      if (over.checkFails) throw new Error("neon unreachable: secret detail");
      return over.actor === undefined ? null : over.actor;
    });
    const limit = vi.fn(async () => ({ allowed: over.allowed ?? true, remaining: 0, retryAfterSeconds: 12 }));
    const deps: MutationDeps = {
      checkSession,
      env,
      limit,
      mutations: { "admin/thing.do": { access: { kind: "role", role: "admin" }, handle, ...over.mutation } as Mutation, "invites/open": { access: { kind: "public" }, handle } },
    };
    const run = (path: string, init: RequestInit = {}) => handleMutation(new Request(`https://scollarly.example${path}`, { method: "POST", ...init }), () => deps);
    return { run, handle, checkSession, limit };
  }

  it("returns null, without building anything, for a request that is not ours", async () => {
    const t = setup();
    expect(await t.run("/api/v1/admin/unknown.op")).toBeNull();
    expect(await handleMutation(new Request("https://x.example/api/v1/admin/thing.do"), () => t as never)).toBeNull();
    expect(t.handle).not.toHaveBeenCalled();
  });

  it("runs the handler for an allowed caller, with the parsed body and the session token", async () => {
    const t = setup({ actor: actorOf("admin") });
    const response = await t.run("/api/v1/admin/thing.do", {
      body: JSON.stringify({ a: 1 }),
      headers: { cookie: "__Secure-neon-auth.session_token=" + "a".repeat(32) + ".sig" },
    });
    expect(response?.status).toBe(200);
    const call = (t.handle.mock.calls[0] as unknown as [{ body: unknown; token: string | null; actor: Actor }])[0];
    expect(call.body).toEqual({ a: 1 });
    expect(call.token).toBe("a".repeat(32));
    expect(call.actor.role).toBe("admin");
  });

  it("treats an empty body as {} and refuses malformed or oversized JSON before the session is checked", async () => {
    const t = setup({ actor: actorOf("admin") });
    expect((await t.run("/api/v1/admin/thing.do"))?.status).toBe(200);
    expect((t.handle.mock.calls[0] as unknown as [{ body: unknown }])[0].body).toEqual({});
    expect((await t.run("/api/v1/admin/thing.do", { body: "{nope" }))?.status).toBe(400);
    expect((await t.run("/api/v1/admin/thing.do", { body: JSON.stringify({ x: "y".repeat(9000) }) }))?.status).toBe(413);
    expect(t.checkSession).toHaveBeenCalledTimes(1);
  });

  it("refuses a cross-origin request first", async () => {
    const t = setup({ actor: actorOf("admin") });
    const response = await t.run("/api/v1/admin/thing.do", { headers: { origin: "https://evil.example" } });
    expect(response?.status).toBe(403);
    expect(t.checkSession).not.toHaveBeenCalled();
    expect(t.handle).not.toHaveBeenCalled();
  });

  it("answers 401, 403 and the step-up code from the access rule, and never runs the handler", async () => {
    expect((await setup({ actor: null }).run("/api/v1/admin/thing.do"))?.status).toBe(401);
    expect((await setup({ actor: actorOf("student") }).run("/api/v1/admin/thing.do"))?.status).toBe(403);
    const t = setup({ actor: actorOf("owner", { stepUpAgoMs: STEP_UP_WINDOW_MS + 1 }), mutation: { access: { kind: "role", role: "owner", stepUp: true } } });
    const response = await t.run("/api/v1/admin/thing.do");
    expect(response?.status).toBe(403);
    expect(((await response?.json()) as { error: { code: string } }).error.code).toBe("STEP_UP_REQUIRED");
    expect(t.handle).not.toHaveBeenCalled();
  });

  it("maps an AuthError from a handler, and hides every other failure behind a request id", async () => {
    const refusing = setup({ actor: actorOf("admin"), mutation: { handle: async () => Promise.reject(new AuthError("FORBIDDEN", "Not allowed.")) } });
    expect((await refusing.run("/api/v1/admin/thing.do"))?.status).toBe(403);

    const broken = setup({ actor: actorOf("admin"), mutation: { handle: async () => Promise.reject(new Error("password=hunter2 at db.internal:5432")) } });
    const response = await broken.run("/api/v1/admin/thing.do");
    expect(response?.status).toBe(500);
    const text = await response?.text();
    expect(text).not.toContain("hunter2");
    expect(text).toContain("request_id");

    const unavailable = setup({ checkFails: true });
    const down = await unavailable.run("/api/v1/admin/thing.do");
    expect(down?.status).toBe(500);
    expect(await down?.text()).not.toContain("secret detail");
  });

  it("rate-limits a public operation without looking at any session, with Retry-After", async () => {
    const t = setup({ allowed: false });
    const response = await t.run("/api/v1/invites/open");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("12");
    expect(t.checkSession).not.toHaveBeenCalled();
    expect(t.handle).not.toHaveBeenCalled();
  });
});
