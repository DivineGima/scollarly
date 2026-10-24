import { describe, expect, it, vi } from "vitest";
import { type Actor, mintActor, type Role } from "@/server/auth/actor";
import { type AuthedDeps, classifyAuthed, handleAuthed } from "@/server/edge/authed";

const actorOf = (role: Role): Actor =>
  mintActor({ userId: `user-${role}`, sessionId: "s1", storedRole: role, role, twoFactorVerifiedAt: null });

const SHELL_HTML = "<html><body>shell with no data</body></html>";
const htmlResponse = () => new Response(SHELL_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "s-maxage=31536000" } });

function setup(over: { actor?: Actor | null; cached?: Response; checkFails?: boolean; next?: () => Response; apiFails?: boolean } = {}) {
  const put = vi.fn(async () => undefined);
  const next = vi.fn(async (_request: Request) => (over.next ? over.next() : htmlResponse()));
  const waitUntil = vi.fn();
  const adminData = vi.fn(async () => {
    if (over.apiFails) throw new Error("database down: secret.internal");
    return { leadCount: 7 };
  });
  const checkSession = vi.fn(async () => {
    if (over.checkFails) throw new Error("neon unreachable");
    return over.actor === undefined ? null : over.actor;
  });
  const deps: AuthedDeps = {
    checkSession,
    cache: { match: vi.fn(async () => over.cached), put },
    next,
    waitUntil,
    api: { "admin/phase0": adminData, "me/phase0": async (actor) => ({ role: actor.role }) },
  };
  const makeDeps = vi.fn(() => deps);
  const run = (path: string, init: RequestInit = {}) => handleAuthed(new Request(`https://scollarly.example${path}`, init), makeDeps);
  return { run, put, next, waitUntil, adminData, checkSession, makeDeps };
}

describe("classifyAuthed: which requests belong to the signed-in path", () => {
  const classify = (path: string, method = "GET", headers: Record<string, string> = {}) =>
    classifyAuthed(method, new URL(`https://x.example${path}`), new Headers(headers));

  it("recognises shells under /admin and /me, with or without the locale and a trailing slash", () => {
    for (const path of ["/admin", "/admin/phase0", "/admin/leads/", "/en/admin/phase0", "/me", "/me/phase0", "/en/me"]) {
      expect(classify(path), path).toMatchObject({ kind: "shell" });
    }
    expect(classify("/admin/phase0")).toEqual({ kind: "shell", area: "admin" });
    expect(classify("/me/phase0")).toEqual({ kind: "shell", area: "me" });
  });

  it("recognises data calls", () => {
    expect(classify("/api/v1/admin/phase0")).toEqual({ kind: "api", area: "admin", name: "phase0" });
    expect(classify("/api/v1/me/phase0")).toEqual({ kind: "api", area: "me", name: "phase0" });
  });

  it("ignores everything else: other methods, public pages, media, auth, lookalike paths and Next.js client navigations", () => {
    for (const path of ["/", "/media/" + "a".repeat(64), "/api/auth/sign-in", "/api/v1/leads", "/administrator", "/media", "/mentor", "/api/v1/admin", "/api/v1/admin/a/b", "/api/v1/other/x"]) {
      expect(classify(path), path).toBeNull();
    }
    expect(classify("/admin/phase0", "POST")).toBeNull();
    expect(classify("/api/v1/admin/phase0", "POST")).toBeNull();
    expect(classify("/admin/phase0", "GET", { rsc: "1" })).toBeNull();
    expect(classify("/admin/phase0?_rsc=abc")).toBeNull();
  });
});

describe("the shell", () => {
  it("answers 404, uncached, to an anonymous visitor, and never reads the cache or starts Next.js", async () => {
    const t = setup({ actor: null, cached: htmlResponse() });
    const response = await t.run("/admin/phase0");
    expect(response?.status).toBe(404);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(t.next).not.toHaveBeenCalled();
    expect(t.put).not.toHaveBeenCalled();
  });

  it("answers 404 to a student on a staff screen and to a failed session lookup", async () => {
    expect((await setup({ actor: actorOf("student") }).run("/admin/phase0"))?.status).toBe(404);
    expect((await setup({ checkFails: true }).run("/admin/phase0"))?.status).toBe(404);
  });

  it("lets staff and the owner into staff screens and any signed-in user into /me", async () => {
    for (const role of ["admin", "owner"] as const) expect((await setup({ actor: actorOf(role) }).run("/admin/phase0"))?.status, role).toBe(200);
    for (const role of ["student", "admin", "owner"] as const) expect((await setup({ actor: actorOf(role) }).run("/me/phase0"))?.status, role).toBe(200);
  });

  it("on a miss runs Next.js once with no cookie, stores a copy, and answers privately", async () => {
    const t = setup({ actor: actorOf("admin") });
    const response = await t.run("/admin/phase0", { headers: { cookie: "__Secure-neon-auth.session_token=secret", accept: "text/html" } });
    expect(await response?.text()).toBe(SHELL_HTML);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(t.next).toHaveBeenCalledTimes(1);
    const forwarded = t.next.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get("cookie")).toBeNull();
    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(t.waitUntil).toHaveBeenCalledTimes(1);
    expect(t.put).toHaveBeenCalledTimes(1);
  });

  it("on a hit answers from the cache without starting Next.js, still privately", async () => {
    const t = setup({ actor: actorOf("admin"), cached: new Response(SHELL_HTML, { headers: { "cache-control": "public, max-age=0, s-maxage=30", "x-edge-cache": "stored" } }) });
    const response = await t.run("/admin/phase0");
    expect(await response?.text()).toBe(SHELL_HTML);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(response?.headers.get("x-edge-cache")).toBeNull();
    expect(t.next).not.toHaveBeenCalled();
  });

  it("does not store an error page or a page that sets a cookie", async () => {
    const broken = setup({ actor: actorOf("admin"), next: () => new Response("boom", { status: 500, headers: { "content-type": "text/html" } }) });
    expect((await broken.run("/admin/phase0"))?.status).toBe(500);
    expect(broken.put).not.toHaveBeenCalled();
    const cookie = setup({ actor: actorOf("admin"), next: () => new Response("x", { status: 200, headers: { "content-type": "text/html", "set-cookie": "a=b" } }) });
    await cookie.run("/admin/phase0");
    expect(cookie.put).not.toHaveBeenCalled();
  });
});

describe("the data call", () => {
  it("returns JSON, never cached, for a user who may see it", async () => {
    const t = setup({ actor: actorOf("admin") });
    const response = await t.run("/api/v1/admin/phase0");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.json()).toEqual({ leadCount: 7 });
    expect(t.adminData).toHaveBeenCalledTimes(1);
  });

  it("answers 401 with no session and 403 for the wrong role, and runs no query in either case", async () => {
    const anonymous = setup({ actor: null });
    expect((await anonymous.run("/api/v1/admin/phase0"))?.status).toBe(401);
    const student = setup({ actor: actorOf("student") });
    const response = await student.run("/api/v1/admin/phase0");
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(anonymous.adminData).not.toHaveBeenCalled();
    expect(student.adminData).not.toHaveBeenCalled();
  });

  it("answers 503 when the session lookup fails and 500 when the query fails, without leaking details", async () => {
    expect((await setup({ checkFails: true }).run("/api/v1/admin/phase0"))?.status).toBe(503);
    const failing = await setup({ actor: actorOf("admin"), apiFails: true }).run("/api/v1/admin/phase0");
    expect(failing?.status).toBe(500);
    expect(JSON.stringify(await failing?.json())).not.toMatch(/secret\.internal|database down/);
  });

  it("serves the student call to a signed-in student with their own role", async () => {
    const response = await setup({ actor: actorOf("student") }).run("/api/v1/me/phase0");
    expect(await response?.json()).toEqual({ role: "student" });
  });

  it("leaves unknown data calls to the normal handler", async () => {
    expect(await setup({ actor: actorOf("admin") }).run("/api/v1/admin/unknown")).toBeNull();
  });
});

describe("requests that are not ours", () => {
  it("return null and never build the database handle", async () => {
    const t = setup({ actor: actorOf("admin") });
    for (const path of ["/", "/media/" + "b".repeat(64), "/api/auth/get-session"]) expect(await t.run(path), path).toBeNull();
    expect(await t.run("/admin/phase0", { method: "POST" })).toBeNull();
    expect(t.makeDeps).not.toHaveBeenCalled();
    expect(t.checkSession).not.toHaveBeenCalled();
  });
});
