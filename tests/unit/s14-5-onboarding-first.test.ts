import { describe, expect, it, vi } from "vitest";
import { mintActor, needsOnboarding, type Actor, type Role } from "@/server/auth/actor";
import { createAuthFacade } from "@/server/auth/facade";
import { sessionNeedsOnboarding } from "@/server/auth/trusted-session";
import { handleAuthed, type AuthedDeps } from "@/server/edge/authed";
import { handleMutation, type Mutation, type MutationDeps } from "@/server/edge/mutations";
import { onboardingPath, readIntent, unconfirmedLanding } from "@/modules/auth/intent";

const actorOf = (storedRole: Role, onboardingDone: boolean): Actor =>
  mintActor({ userId: "u1", sessionId: "s1", storedRole, role: storedRole, twoFactorVerifiedAt: null, onboardingDone });

describe("S14.5: who has to finish onboarding", () => {
  it("asks only a student who has not finished, never staff or an owner without 2FA", () => {
    expect(needsOnboarding(actorOf("student", false))).toBe(true);
    expect(needsOnboarding(actorOf("student", true))).toBe(false);
    expect(needsOnboarding(actorOf("admin", false))).toBe(false);
    expect(needsOnboarding(actorOf("owner", false))).toBe(false);
  });

  it("is the same question for a session (the lead endpoint)", () => {
    expect(sessionNeedsOnboarding({ role: "student", onboardingDone: false })).toBe(true);
    expect(sessionNeedsOnboarding({ role: "student", onboardingDone: true })).toBe(false);
    expect(sessionNeedsOnboarding({ role: "student" })).toBe(false);
    expect(sessionNeedsOnboarding({ role: "admin", onboardingDone: false })).toBe(false);
    expect(sessionNeedsOnboarding({ role: "owner", onboardingDone: false })).toBe(false);
  });

  it("is carried from the session into the actor, and an old resolver without it counts as done", async () => {
    const base = { userId: "u", sessionId: "s", email: "a@x.test", emailVerified: true, role: "student", stepUpAt: null };
    const headers = new Headers({ cookie: "__Secure-neon-auth.session_token=abcdefghijklmnop1234567890.sig" });
    expect((await createAuthFacade(async () => ({ ...base, onboardingDone: false })).checkSession(headers))?.onboardingDone).toBe(false);
    expect((await createAuthFacade(async () => base).checkSession(headers))?.onboardingDone).toBe(true);
  });
});

function authed(actor: Actor | null) {
  const next = vi.fn(async () => new Response("<html>shell</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
  const call = vi.fn(async () => ({ ok: true }));
  const deps: AuthedDeps = {
    checkSession: async () => actor,
    cache: { match: async () => undefined, put: async () => undefined },
    next,
    waitUntil: () => undefined,
    api: { "me/home": call, "me/onboarding-state": call, "admin/home": call },
  };
  return { run: (path: string) => handleAuthed(new Request(`https://scollarly.test${path}`), () => deps), call, next };
}

describe("S14.5: the student area before onboarding is finished (data calls and screens)", () => {
  const student = actorOf("student", false);

  it("refuses every data call except the questionnaire's own with 403 ONBOARDING_REQUIRED", async () => {
    const t = authed(student);
    const refused = await t.run("/api/v1/me/home");
    expect(refused?.status).toBe(403);
    expect(((await refused?.json()) as { error: { code: string } }).error.code).toBe("ONBOARDING_REQUIRED");
    expect(t.call).not.toHaveBeenCalled();
    expect((await t.run("/api/v1/me/onboarding-state"))?.status).toBe(200);
  });

  it("sends any other screen to the questionnaire and serves only the questionnaire's own shell", async () => {
    const t = authed(student);
    for (const path of ["/me", "/me/universities", "/en/me/progress", "/me/notifications"]) {
      const response = await t.run(path);
      expect(response?.status, path).toBe(302);
      expect(response?.headers.get("location"), path).toBe("https://scollarly.test/me/onboarding");
    }
    expect(t.next).not.toHaveBeenCalled();
    expect((await t.run("/me/onboarding"))?.status).toBe(200);
    expect((await t.run("/en/me/onboarding"))?.status).toBe(200);
  });

  it("changes nothing for a student who has finished, for staff, or for the admin area", async () => {
    expect((await authed(actorOf("student", true)).run("/api/v1/me/home"))?.status).toBe(200);
    expect((await authed(actorOf("student", true)).run("/me"))?.status).toBe(200);
    expect((await authed(actorOf("admin", false)).run("/api/v1/admin/home"))?.status).toBe(200);
    expect((await authed(actorOf("owner", false)).run("/me"))?.status).toBe(200);
  });
});

describe("S14.5: student changes before onboarding is finished", () => {
  const handle = vi.fn(async () => new Response("done", { status: 200 }));
  const mutations: Record<string, Mutation> = {
    "me/onboarding": { access: { kind: "signed-in" }, beforeOnboarding: true, handle },
    "me/profile.update": { access: { kind: "signed-in" }, handle },
    "admin/anything": { access: { kind: "role", role: "admin" }, handle },
  };
  const run = (actor: Actor, path: string) => {
    const deps = { checkSession: async () => actor, mutations, env: { now: () => new Date() }, limit: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }) } as unknown as MutationDeps;
    return handleMutation(new Request(`https://scollarly.test/api/v1/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://scollarly.test" }, body: "{}" }), () => deps);
  };

  it("allows the one that finishes onboarding and refuses the rest", async () => {
    const student = actorOf("student", false);
    expect((await run(student, "me/onboarding"))?.status).toBe(200);
    const refused = await run(student, "me/profile.update");
    expect(refused?.status).toBe(403);
    expect(((await refused?.json()) as { error: { code: string } }).error.code).toBe("ONBOARDING_REQUIRED");
  });

  it("does not touch a finished student or staff", async () => {
    expect((await run(actorOf("student", true), "me/profile.update"))?.status).toBe(200);
    expect((await run(actorOf("admin", false), "admin/anything"))?.status).toBe(200);
  });
});

describe("S14.5: the page they came from rides to the questionnaire", () => {
  it("is kept in the questionnaire address and checked", () => {
    const url = new URL("https://x.test/auth/landing?intent=sign-up&as=parent&next=%2Fapply");
    const intent = readIntent(url);
    expect(onboardingPath(intent.as ?? "student", intent.course, true, intent.next)).toBe("/me/onboarding?as=parent&next=%2Fapply");
    expect(unconfirmedLanding(intent).path).toBe("/me/onboarding?as=parent&next=%2Fapply");
    expect(onboardingPath("student", null, true, null)).toBe("/me/onboarding?as=student");
  });
});
