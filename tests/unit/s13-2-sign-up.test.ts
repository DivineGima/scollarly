import { readFileSync } from "node:fs";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.fn();
const complete = vi.fn();
vi.mock("@/server/auth/session", () => ({
  startGoogleSignIn: (...args: unknown[]) => start(...args),
  completeSignIn: (...args: unknown[]) => complete(...args),
}));

import { CONFIRM_PATH, DEFAULT_INTENT, intentParams, ONBOARDING_READY, onboardingPath, readIntent, unconfirmedLanding } from "@/modules/auth/intent";
import { AuthError, mintActor, type Actor } from "@/server/auth/actor";
import { SESSION_COOKIE_NAME } from "@/server/auth/cookie";
import { createAuthFacade } from "@/server/auth/facade";
import { type AuthedDeps, handleAuthed } from "@/server/edge/authed";
import { denyAccess, type Access } from "@/server/edge/mutations";
import { handleSignIn } from "@/server/edge/sign-in";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S13.2 (architecture 21.3, ADR-042): Sign in and Create account are different things, and a Google login with no confirmed Scollarly
 * account can do nothing but confirm one. The database side is in tests/integration/s13-2-sign-up.test.ts.
 */

const urlOf = (path: string) => new URL(`https://scollarly.example${path}`);

describe("the intent (21.3)", () => {
  it("defaults to sign in, and reads Create account with who and which course", () => {
    expect(readIntent(urlOf("/auth/start"))).toEqual(DEFAULT_INTENT);
    expect(readIntent(urlOf("/auth/start?intent=sign-up&as=parent&course=law"))).toEqual({ intent: "sign-up", as: "parent", course: "law" });
    expect(readIntent(urlOf("/auth/start?intent=sign-up"))).toEqual({ intent: "sign-up", as: null, course: null });
  });

  it("drops anything it does not know, instead of passing it on", () => {
    expect(readIntent(urlOf("/auth/start?intent=admin&as=owner&course=astrology"))).toEqual(DEFAULT_INTENT);
    expect(readIntent(urlOf("/auth/start?intent=sign-up&as=guardian&course=%3Cscript%3E"))).toEqual({ intent: "sign-up", as: null, course: null });
  });

  it("carries nothing extra for a plain sign in, so existing links do not change", () => {
    expect(intentParams(DEFAULT_INTENT).toString()).toBe("");
    expect(intentParams({ intent: "sign-in", as: "parent", course: "law" }).toString()).toBe("");
    expect(intentParams({ intent: "sign-up", as: "student", course: "law" }).toString()).toBe("intent=sign-up&as=student&course=law");
  });

  it("sends Sign in to the confirm screen and Create account straight on to onboarding", () => {
    expect(ONBOARDING_READY).toBe(true);
    expect(unconfirmedLanding(DEFAULT_INTENT)).toEqual({ confirmNow: false, path: CONFIRM_PATH, as: "student" });
    expect(unconfirmedLanding({ intent: "sign-up", as: "parent", course: null })).toEqual({ confirmNow: true, path: "/me/onboarding?as=parent", as: "parent" });
  });

  it("goes to the student home instead while onboarding is switched off, and carries who and which course when it is on", () => {
    expect(unconfirmedLanding({ intent: "sign-up", as: "parent", course: null }, false)).toEqual({ confirmNow: true, path: "/me", as: "parent" });
    expect(unconfirmedLanding({ intent: "sign-up", as: "parent", course: "law" }, true)).toEqual({ confirmNow: true, path: "/me/onboarding?as=parent&course=law", as: "parent" });
    expect(unconfirmedLanding({ intent: "sign-up", as: null, course: null }, true).path).toBe("/me/onboarding?as=student");
    expect(onboardingPath("student", null, false)).toBe("/me");
  });
});

describe("the sign-in steps carry the intent (F14)", () => {
  const env = { NEON_AUTH_BASE_URL: "https://auth.example/neondb/auth", NEON_AUTH_COOKIE_SECRET: "s".repeat(32) } as CloudflareEnv;
  const get = (path: string) => new Request(`https://scollarly.example${path}`);

  beforeEach(() => {
    start.mockReset().mockResolvedValue(new Response(null, { status: 302 }));
    complete.mockReset().mockResolvedValue(new Response(null, { status: 302 }));
  });

  it("passes Create account through the whole trip, with who and the course", async () => {
    await handleSignIn(get("/auth/start?intent=sign-up&as=parent&course=law"), env);
    expect(start.mock.calls[0]?.[2]).toBe("/auth/return?intent=sign-up&as=parent&course=law");
    await handleSignIn(get("/auth/return?intent=sign-up&as=parent&course=law&neon_auth_session_verifier=abc"), env);
    expect(complete.mock.calls[0]?.[2]).toBe("/auth/landing?intent=sign-up&as=parent&course=law");
  });

  it("keeps the invite and the intent together, and leaves a plain sign in exactly as it was", async () => {
    const invite = "A".repeat(43);
    await handleSignIn(get(`/auth/start?intent=sign-up&invite=${invite}`), env);
    expect(start.mock.calls[0]?.[2]).toBe(`/auth/return?intent=sign-up&invite=${invite}`);
    start.mockClear();
    await handleSignIn(get("/auth/start"), env);
    expect(start.mock.calls[0]?.[2]).toBe("/auth/return");
  });

  it("drops an unknown intent on the way", async () => {
    await handleSignIn(get("/auth/start?intent=owner&as=owner"), env);
    expect(start.mock.calls[0]?.[2]).toBe("/auth/return");
  });

  it("has no endpoint that says whether an email has an account: the start step reads no email at all", () => {
    const source = readFileSync("src/server/edge/sign-in.ts", "utf8");
    expect(source).not.toMatch(/email/i);
    expect(readFileSync("src/modules/auth/intent.ts", "utf8")).not.toMatch(/email/i);
  });
});

const actorOf = (accountConfirmed: boolean, role: "student" | "admin" | "owner" = "student"): Actor =>
  mintActor({ userId: "u1", sessionId: "s1", storedRole: role, role, twoFactorVerifiedAt: role === "owner" ? new Date() : null, accountConfirmed });

describe("what an unconfirmed login may do: only confirm (ADR-042)", () => {
  const accesses: Access[] = [{ kind: "signed-in" }, { kind: "role", role: "student" }, { kind: "role", role: "admin" }, { kind: "stored-owner" }];

  it("is refused by every operation except account/confirm, with its own code", () => {
    for (const access of accesses) {
      expect(denyAccess(access, actorOf(false), new Date()), JSON.stringify(access)).toEqual({ status: 403, code: "ACCOUNT_NOT_CONFIRMED", message: "Create your account to continue." });
    }
    expect(denyAccess({ kind: "account" }, actorOf(false), new Date())).toBeNull();
  });

  it("changes nothing for a confirmed account", () => {
    expect(denyAccess({ kind: "signed-in" }, actorOf(true), new Date())).toBeNull();
    expect(denyAccess({ kind: "role", role: "admin" }, actorOf(true), new Date())).toMatchObject({ code: "FORBIDDEN" });
    expect(denyAccess({ kind: "role", role: "admin" }, actorOf(true, "admin"), new Date())).toBeNull();
    expect(denyAccess({ kind: "account" }, actorOf(true), new Date())).toBeNull();
  });

  it("still tells an anonymous caller to sign in, even for account/confirm", () => {
    expect(denyAccess({ kind: "account" }, null, new Date())).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(denyAccess({ kind: "signed-in" }, null, new Date())).toMatchObject({ status: 401 });
  });

  it("is refused by requireRole in the facade", async () => {
    const headers = new Headers({ cookie: `${SESSION_COOKIE_NAME}=abcdefghijklmnopqrstuvwxyz012345` });
    const facadeFor = (accountConfirmed: boolean) => createAuthFacade(async () => ({ userId: "u", sessionId: "s", email: "a@example.test", emailVerified: true, role: "student", stepUpAt: null, accountConfirmed }));
    await expect(facadeFor(false).requireRole(headers, "student")).rejects.toMatchObject({ code: "ACCOUNT_NOT_CONFIRMED" });
    await expect(facadeFor(false).requireRole(headers, "student")).rejects.toBeInstanceOf(AuthError);
    expect((await facadeFor(true).requireRole(headers, "student")).userId).toBe("u");
  });
});

describe("the signed-in path refuses an unconfirmed login", () => {
  function setup(actor: Actor | null) {
    const calls = { me: 0, account: 0 };
    const deps: AuthedDeps = {
      checkSession: async () => actor,
      cache: { match: async () => new Response("<html>shell</html>", { headers: { "content-type": "text/html" } }), put: async () => undefined },
      next: async () => new Response("<html>next</html>", { headers: { "content-type": "text/html" } }),
      waitUntil: () => undefined,
      api: { "me/phase0": async () => (calls.me += 1, { ok: true }), "account/state": async () => (calls.account += 1, { ok: true }) },
    };
    return { calls, run: (path: string) => handleAuthed(new Request(`https://scollarly.example${path}`), () => deps) };
  }

  it("answers 404 to the shells of /me and /admin, and 403 ACCOUNT_NOT_CONFIRMED to their data, without running them", async () => {
    const { run, calls } = setup(actorOf(false));
    expect((await run("/me"))?.status).toBe(404);
    expect((await run("/admin"))?.status).toBe(404);
    const data = await run("/api/v1/me/phase0");
    expect(data?.status).toBe(403);
    expect(((await data?.json()) as { error: { code: string } }).error.code).toBe("ACCOUNT_NOT_CONFIRMED");
    expect(calls.me).toBe(0);
  });

  it("serves the account area to the same login", async () => {
    const { run, calls } = setup(actorOf(false));
    expect((await run("/account/confirm"))?.status).toBe(200);
    expect((await run("/api/v1/account/state"))?.status).toBe(200);
    expect(calls.account).toBe(1);
  });

  it("serves a confirmed student as before, and nobody who is signed out", async () => {
    expect((await setup(actorOf(true)).run("/me"))?.status).toBe(200);
    expect((await setup(actorOf(true)).run("/api/v1/me/phase0"))?.status).toBe(200);
    expect((await setup(null).run("/account/confirm"))?.status).toBe(404);
    expect((await setup(null).run("/api/v1/account/state"))?.status).toBe(401);
  });

  it("keeps the owner out of /admin only while the owner is unconfirmed, which the database prevents", async () => {
    expect((await setup(actorOf(true, "owner")).run("/admin"))?.status).toBe(200);
  });
});

describe("the three screens", () => {
  it("has the same sign in, sign up and confirm strings in English and French", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value !== null && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];
    expect(keys(fr.auth).sort()).toEqual(keys(en.auth).sort());
  });

  it("says it plainly: Sign in is for people who have an account, and there is a way to create one", () => {
    expect(en.auth.signIn.title).toBe("Welcome back");
    expect(en.auth.signIn.intro).toMatch(/already have an account/);
    expect(en.auth.signIn.createAccount).toBe("Create an account");
    expect(en.auth.confirm.title).toBe("No account found");
  });

  it("renders the student and parent links with the intent, with no script needed", async () => {
    const { SignUpChoices } = await import("@/components/auth/sign-up-choices");
    const { NextIntlClientProvider } = await import("next-intl");
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: { auth: en.auth } } as unknown as ComponentProps<typeof NextIntlClientProvider>, createElement(SignUpChoices)));
    expect(html).toContain('href="/auth/start?intent=sign-up&amp;as=student"');
    expect(html).toContain('href="/auth/start?intent=sign-up&amp;as=parent"');
    expect(html).toContain("I am a student");
    expect(html).toContain("I am a parent applying for my child");
  });
});
