import { describe, expect, it, vi } from "vitest";
import { type ResolvedSession, STEP_UP_WINDOW_MS } from "@/server/auth/actor";
import { AuthError } from "@/server/auth/actor";
import { createAuthFacade } from "@/server/auth/facade";

const COOKIE = "__Secure-neon-auth.session_token";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const withSession = (token: string | null = TOKEN) => new Headers(token ? { cookie: `${COOKIE}=${token}.sig` } : {});

const session = (over: Partial<ResolvedSession> = {}): ResolvedSession => ({
  userId: "u-1",
  sessionId: "s-1",
  email: "a@example.test",
  emailVerified: true,
  role: "student",
  stepUpAt: null,
  ...over,
});

const facadeFor = (result: ResolvedSession | null) => {
  const resolve = vi.fn(async () => result);
  return { resolve, ...createAuthFacade(resolve) };
};

describe("checkSession: one query per request, no cache (ADR-034, ADR-020)", () => {
  it("returns null without touching the database when there is no session cookie", async () => {
    const f = facadeFor(session());
    expect(await f.checkSession(withSession(null))).toBeNull();
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it("returns null for an unknown, expired or banned session (the query returns nothing)", async () => {
    expect(await facadeFor(null).checkSession(withSession())).toBeNull();
  });

  it("returns null when Google did not report the email as verified", async () => {
    expect(await facadeFor(session({ emailVerified: false })).checkSession(withSession())).toBeNull();
  });

  it("asks the database once per call and passes only the token, never the signature", async () => {
    const f = facadeFor(session());
    await f.checkSession(withSession());
    await f.checkSession(withSession());
    expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.resolve).toHaveBeenCalledWith(TOKEN);
  });

  it("mints an actor from what the database says, so a role change shows on the very next request", async () => {
    const actor = await facadeFor(session({ role: "admin" })).checkSession(withSession());
    expect(actor).toMatchObject({ userId: "u-1", sessionId: "s-1", storedRole: "admin", role: "admin", twoFactorVerifiedAt: null });
    const demoted = await facadeFor(session({ role: "student" })).checkSession(withSession());
    expect(demoted?.role).toBe("student");
  });

  it("treats an unknown stored role as student", async () => {
    expect((await facadeFor(session({ role: "superuser" })).checkSession(withSession()))?.role).toBe("student");
  });

  it("gives an owner without a second-factor check student powers, and owner powers after it", async () => {
    expect((await facadeFor(session({ role: "owner" })).checkSession(withSession()))?.role).toBe("student");
    const verified = new Date();
    const actor = await facadeFor(session({ role: "owner", stepUpAt: verified })).checkSession(withSession());
    expect(actor).toMatchObject({ storedRole: "owner", role: "owner", twoFactorVerifiedAt: verified });
  });
});

describe("requireRole and requireOwner", () => {
  it("throws UNAUTHENTICATED without a session and FORBIDDEN for too low a role", async () => {
    await expect(facadeFor(null).requireRole(withSession(), "student")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(facadeFor(session()).requireRole(withSession(), "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(facadeFor(session()).requireRole(withSession(), "admin")).rejects.toBeInstanceOf(AuthError);
  });

  it("lets admins and the verified owner in, and refuses an owner who has not passed 2FA", async () => {
    await expect(facadeFor(session({ role: "admin" })).requireRole(withSession(), "admin")).resolves.toMatchObject({ role: "admin" });
    await expect(facadeFor(session({ role: "owner", stepUpAt: new Date() })).requireOwner(withSession())).resolves.toMatchObject({ role: "owner" });
    await expect(facadeFor(session({ role: "owner" })).requireOwner(withSession())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires a fresh second-factor check for destructive owner actions (10 minutes)", async () => {
    const verified = new Date("2026-10-24T10:00:00Z");
    const f = facadeFor(session({ role: "owner", stepUpAt: verified }));
    await expect(f.requireOwner(withSession(), { stepUp: true, now: new Date(verified.getTime() + STEP_UP_WINDOW_MS) })).resolves.toBeDefined();
    await expect(f.requireOwner(withSession(), { stepUp: true, now: new Date(verified.getTime() + STEP_UP_WINDOW_MS + 1) })).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
  });
});
