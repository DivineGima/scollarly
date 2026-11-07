import { describe, expect, it, vi } from "vitest";
import { type Actor, mintActor, type Role } from "@/server/auth/actor";
import { ACCOUNT_PATH, accountDestination, handleAccount, type AccountDeps } from "@/server/edge/account";

/**
 * S15.5 (PRD_4 F25, FR-36; architecture 23.7): the account address and the forward away from the sign-in forms. The decisions are pure or take
 * their session check as an argument, so every case runs without a Worker or a database.
 */

const COOKIE = { cookie: "__Secure-neon-auth.session_token=abcdefgh12345678abcdefgh12345678.c2lnbmF0dXJl" };
const actorOf = (role: Role, over: { confirmed?: boolean; onboarded?: boolean; verified?: boolean } = {}): Actor =>
  mintActor({
    userId: `user-${role}`,
    sessionId: "s1",
    storedRole: role,
    role,
    twoFactorVerifiedAt: over.verified ? new Date() : null,
    accountConfirmed: over.confirmed ?? true,
    onboardingDone: over.onboarded ?? true,
  });

function setup(actor: Actor | null | "throws", enrolled = false) {
  const checkSession = vi.fn(async () => {
    if (actor === "throws") throw new Error("neon unreachable");
    return actor;
  });
  const getTotp = vi.fn(async () => ({ confirmed: enrolled }));
  const deps = { checkSession, env: { db: {} } } as unknown as AccountDeps;
  const run = (path: string, init: RequestInit = {}) => handleAccount(new Request(`https://scollarly.example${path}`, init), () => deps);
  return { run, checkSession, getTotp };
}

describe("accountDestination: the home of each person", () => {
  it("sends a student to /me, staff to /admin, and an owner to the second-factor step they still owe", () => {
    expect(accountDestination(actorOf("student"), false)).toBe("/me");
    expect(accountDestination(actorOf("manager"), false)).toBe("/admin");
    expect(accountDestination(actorOf("admin", { verified: true }), true)).toBe("/admin");
    expect(accountDestination(actorOf("admin"), true)).toBe("/two-factor/verify");
    expect(accountDestination(actorOf("admin"), false)).toBe("/two-factor/enrol");
  });

  it("sends an unconfirmed account to the confirm screen and an unfinished student to the questionnaire", () => {
    expect(accountDestination(actorOf("student", { confirmed: false }), false)).toBe("/account/confirm");
    expect(accountDestination(actorOf("student", { onboarded: false }), false)).toMatch(/^\/me\/onboarding\?as=student/);
    expect(accountDestination(actorOf("manager", { onboarded: false }), false)).toBe("/admin");
  });
});

describe("GET /account", () => {
  it("sends a request with no session cookie to /sign-in without any lookup", async () => {
    const { run, checkSession } = setup(actorOf("student"));
    const response = await run(ACCOUNT_PATH);
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("https://scollarly.example/sign-in");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(checkSession).not.toHaveBeenCalled();
  });

  it("sends a valid session to its home after one session read", async () => {
    const { run, checkSession } = setup(actorOf("student"));
    const response = await run("/account", { headers: COOKIE });
    expect(response?.headers.get("location")).toBe("https://scollarly.example/me");
    expect(checkSession).toHaveBeenCalledTimes(1);
  });

  it("sends a forged or expired cookie to /sign-in", async () => {
    const { run } = setup(null);
    expect((await run("/account", { headers: COOKIE }))?.headers.get("location")).toBe("https://scollarly.example/sign-in");
  });

  it("says the service is busy when the session lookup fails, and never throws", async () => {
    const { run } = setup("throws");
    expect((await run("/account", { headers: COOKIE }))?.headers.get("location")).toBe("https://scollarly.example/sign-in?error=unavailable");
  });

  it("accepts the /en prefix and a trailing slash, answers HEAD, and leaves other methods and addresses alone", async () => {
    const { run } = setup(actorOf("manager"));
    expect((await run("/en/account/", { headers: COOKIE }))?.headers.get("location")).toBe("https://scollarly.example/admin");
    expect((await run("/account", { method: "HEAD", headers: COOKIE }))?.status).toBe(302);
    expect(await run("/account", { method: "POST", headers: COOKIE })).toBeNull();
    expect(await run("/accounts", { headers: COOKIE })).toBeNull();
    expect(await run("/account/confirm", { headers: COOKIE })).toBeNull();
  });
});

describe("GET /sign-in and /sign-up for a person who is signed in", () => {
  it("serves the cached page (null) to a visitor with no cookie, with no lookup", async () => {
    const { run, checkSession } = setup(actorOf("student"));
    expect(await run("/sign-in")).toBeNull();
    expect(await run("/sign-up")).toBeNull();
    expect(checkSession).not.toHaveBeenCalled();
  });

  it("forwards a valid session to its home", async () => {
    const { run } = setup(actorOf("student"));
    expect((await run("/sign-in", { headers: COOKIE }))?.headers.get("location")).toBe("https://scollarly.example/me");
    expect((await run("/sign-up?next=%2Funiversities", { headers: COOKIE }))?.headers.get("location")).toBe("https://scollarly.example/me");
  });

  it("shows the form to a forged cookie after one lookup, and when the lookup fails", async () => {
    expect(await setup(null).run("/sign-in", { headers: COOKIE })).toBeNull();
    expect(await setup("throws").run("/sign-in", { headers: COOKIE })).toBeNull();
  });

  it("shows a sign-in page that carries an error message as it is", async () => {
    const { run, checkSession } = setup(actorOf("student"));
    expect(await run("/sign-in?error=failed", { headers: COOKIE })).toBeNull();
    expect(checkSession).not.toHaveBeenCalled();
  });
});
