import { describe, expect, it, vi } from "vitest";
import { AuthError, STEP_UP_WINDOW_MS } from "@/server/auth/actor";
import type { Auth } from "@/server/auth/auth";
import { createAuthFacade } from "@/server/auth/facade";

type Role = "student" | "admin" | "owner";

function session(role: Role, twoFactorVerifiedAt: Date | null = null) {
  return {
    user: { id: `user-${role}`, role },
    session: { id: `session-${role}`, twoFactorVerifiedAt },
  };
}

/** A stand-in for Better Auth that records how `getSession` was called. */
function fakeAuth(sequence: Array<ReturnType<typeof session> | null>) {
  const getSession = vi.fn(async (_args: { headers: Headers; query: { disableCookieCache: boolean } }) => sequence.shift() ?? null);
  return { auth: { api: { getSession } } as unknown as Auth, getSession };
}

const headers = new Headers({ cookie: "x=1" });
const verifiedAt = new Date("2026-10-23T10:00:00Z");

describe("checkSession: fresh versus cached lookups (ADR-020)", () => {
  it("does a FRESH lookup by default, so a removed admin is refused on the very next request", async () => {
    const { auth, getSession } = fakeAuth([session("admin")]);
    const actor = await createAuthFacade(() => auth).checkSession(headers);
    expect(actor?.role).toBe("admin");
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession.mock.calls[0]?.[0].query.disableCookieCache).toBe(true);
  });

  it("lets a student read opt in to the cookie cache, with one lookup", async () => {
    const { auth, getSession } = fakeAuth([session("student")]);
    const actor = await createAuthFacade(() => auth).checkSession(headers, { allowCookieCache: true });
    expect(actor?.role).toBe("student");
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession.mock.calls[0]?.[0].query.disableCookieCache).toBe(false);
  });

  it("re-reads from the database when a cached copy claims a privileged role", async () => {
    // The cache says admin; the database says the user was demoted to student.
    const { auth, getSession } = fakeAuth([session("admin"), session("student")]);
    const actor = await createAuthFacade(() => auth).checkSession(headers, { allowCookieCache: true });
    expect(actor?.role).toBe("student");
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(getSession.mock.calls[1]?.[0].query.disableCookieCache).toBe(true);
  });

  it("returns null when there is no session, and null when the fresh re-read finds the session revoked", async () => {
    expect(await createAuthFacade(() => fakeAuth([null]).auth).checkSession(headers)).toBeNull();
    const { auth } = fakeAuth([session("owner", verifiedAt), null]);
    expect(await createAuthFacade(() => auth).checkSession(headers, { allowCookieCache: true })).toBeNull();
  });
});

describe("owner powers need a 2FA-verified session (architecture 9.3)", () => {
  it("gives an owner session with no 2FA check the powers of a student only", async () => {
    const facade = createAuthFacade(() => fakeAuth([session("owner", null)]).auth);
    const actor = await facade.checkSession(headers);
    expect(actor).toMatchObject({ storedRole: "owner", role: "student", twoFactorVerifiedAt: null });
  });

  it("refuses requireRole('admin') and requireOwner for that session", async () => {
    await expect(createAuthFacade(() => fakeAuth([session("owner", null)]).auth).requireRole(headers, "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAuthFacade(() => fakeAuth([session("owner", null)]).auth).requireOwner(headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gives owner and admin powers once the session passed 2FA", async () => {
    const owner = await createAuthFacade(() => fakeAuth([session("owner", verifiedAt)]).auth).requireOwner(headers);
    expect(owner.role).toBe("owner");
    const admin = await createAuthFacade(() => fakeAuth([session("owner", verifiedAt)]).auth).requireRole(headers, "admin");
    expect(admin.role).toBe("owner");
  });

  it("does not demand 2FA of an admin", async () => {
    expect((await createAuthFacade(() => fakeAuth([session("admin")]).auth).requireRole(headers, "admin")).role).toBe("admin");
  });
});

describe("requireRole", () => {
  it("throws UNAUTHENTICATED when signed out", async () => {
    await expect(createAuthFacade(() => fakeAuth([null]).auth).requireRole(headers, "student")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("throws FORBIDDEN when the role is too low", async () => {
    await expect(createAuthFacade(() => fakeAuth([session("student")]).auth).requireRole(headers, "admin")).rejects.toBeInstanceOf(AuthError);
    await expect(createAuthFacade(() => fakeAuth([session("admin")]).auth).requireOwner(headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("treats an unknown stored role as a student", async () => {
    const odd = { user: { id: "u", role: "root" }, session: { id: "s", twoFactorVerifiedAt: null } };
    const { auth } = fakeAuth([odd as unknown as ReturnType<typeof session>]);
    expect((await createAuthFacade(() => auth).checkSession(headers))?.role).toBe("student");
  });
});

describe("step-up (10 minutes) for destructive owner actions", () => {
  const owner = (verified: Date) => createAuthFacade(() => fakeAuth([session("owner", verified)]).auth);

  it("passes inside the window", async () => {
    const now = new Date(verifiedAt.getTime() + STEP_UP_WINDOW_MS - 1);
    await expect(owner(verifiedAt).requireOwner(headers, { stepUp: true, now })).resolves.toMatchObject({ role: "owner" });
  });

  it("expires after 10 minutes and asks to re-confirm", async () => {
    const now = new Date(verifiedAt.getTime() + STEP_UP_WINDOW_MS + 1);
    await expect(owner(verifiedAt).requireOwner(headers, { stepUp: true, now })).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
  });

  it("is not demanded when the action is not destructive", async () => {
    const now = new Date(verifiedAt.getTime() + 60 * STEP_UP_WINDOW_MS);
    await expect(owner(verifiedAt).requireOwner(headers, { now })).resolves.toMatchObject({ role: "owner" });
  });
});

describe("the Actor", () => {
  it("is frozen, so a caller cannot promote themselves after the facade issues it", async () => {
    const actor = await createAuthFacade(() => fakeAuth([session("student")]).auth).checkSession(headers);
    expect(Object.isFrozen(actor)).toBe(true);
    expect(() => {
      (actor as unknown as { role: string }).role = "owner";
    }).toThrow();
  });
});
