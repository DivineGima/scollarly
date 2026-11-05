import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isPublicPagePath } from "@/lib/public-paths";
import { intentParams, onboardingPath, readIntent, unconfirmedLanding } from "@/modules/auth/intent";
import { authHref, safeNext } from "@/modules/gate/next";
import { applyForwardTarget, handleApplyForward } from "@/server/edge/legacy-redirects";

describe("S14.3: safeNext is an allow-list, never an open redirect", () => {
  it("accepts the public pages, the Apply address and the course form", () => {
    expect(safeNext("/apply")).toBe("/apply");
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/universities/alpha-university")).toBe("/universities/alpha-university");
    expect(safeNext("/blog/")).toBe("/blog");
    expect(safeNext("/?course=commerce")).toBe("/?course=commerce");
  });

  it("drops everything else", () => {
    for (const bad of [
      "https://evil.example/", "//evil.example", "/\evil.example", "javascript:alert(1)", "/admin", "/me", "/api/v1/leads", "/sign-in", "/sign-out",
      "/?course=nope", "/apply#x", "/apply\n", "/applyx", "/apply/x", "/universities/Bad Slug", "", "apply", null, undefined, `/${"a".repeat(300)}`,
    ]) {
      expect(safeNext(bad as string)).toBeNull();
    }
  });

  it("builds the sign-in and sign-up links, and the plain page when next is not allowed", () => {
    expect(authHref("/sign-in", "/apply")).toBe("/sign-in?next=%2Fapply");
    expect(authHref("/sign-up", "/universities/alpha-university")).toBe("/sign-up?next=%2Funiversities%2Falpha-university");
    expect(authHref("/sign-in", "https://evil.example")).toBe("/sign-in");
    expect(authHref("/sign-up", null)).toBe("/sign-up");
  });
});

describe("S14.3: next rides along the Google trip", () => {
  it("is read, checked and written back; a bad value is dropped", () => {
    const intent = readIntent(new URL("https://x.test/auth/start?next=%2Fapply"));
    expect(intent.next).toBe("/apply");
    expect(intentParams(intent).toString()).toBe("next=%2Fapply");
    expect(readIntent(new URL("https://x.test/auth/start?next=https%3A%2F%2Fevil.example")).next).toBeNull();
    expect(intentParams(readIntent(new URL("https://x.test/auth/start"))).toString()).toBe("");
  });

  it("is kept with sign-up and the course, and reaches onboarding or the confirm screen", () => {
    const up = readIntent(new URL("https://x.test/auth/start?intent=sign-up&as=parent&course=law&next=%2Fprocess"));
    expect(intentParams(up).toString()).toBe("intent=sign-up&as=parent&course=law&next=%2Fprocess");
    expect(unconfirmedLanding(up).path).toBe("/me/onboarding?as=parent&course=law&next=%2Fprocess");
    expect(onboardingPath("student", null, true, "/apply")).toBe("/me/onboarding?as=student&next=%2Fapply");
    const inn = readIntent(new URL("https://x.test/auth/start?next=%2Fapply"));
    expect(unconfirmedLanding(inn).path).toBe("/account/confirm?next=%2Fapply");
  });
});

describe("S15.4: the old Apply address", () => {
  it("is still a valid place to return to, with any query dropped, and is not a public page any more", () => {
    expect(safeNext("/apply")).toBe("/apply");
    expect(safeNext("/apply/")).toBe("/apply");
    expect(safeNext("/apply?university=3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe("/apply");
    expect(safeNext("/apply?other=1")).toBe("/apply");
    expect(isPublicPagePath("/apply")).toBe(false);
  });

  it("forwards a person with a session to the Apply screen, and anyone else to Sign in with the Apply address to return to", () => {
    expect(applyForwardTarget("/apply", true)).toBe("/me/apply");
    expect(applyForwardTarget("/apply/", true)).toBe("/me/apply");
    expect(applyForwardTarget("/en/apply", true)).toBe("/en/me/apply");
    expect(applyForwardTarget("/apply", false)).toBe("/sign-in?next=%2Fapply");
    expect(applyForwardTarget("/en/apply", false)).toBe("/en/sign-in?next=%2Fapply");
    // The forwarded address must itself be accepted by the return-address check, or the trip would end on the plain sign-in page.
    expect(safeNext(decodeURIComponent("/apply"))).toBe("/apply");
  });

  it("leaves every other address alone", () => {
    for (const path of ["/", "/me/apply", "/applying", "/apply/x", "/universities/apply", "/api/v1/me/application"]) expect(applyForwardTarget(path, true)).toBeNull();
  });

  it("answers GET and HEAD with a 302 that is never stored, and nothing else", () => {
    const get = handleApplyForward(new Request("https://scollarly.test/apply", { headers: { cookie: "__Secure-neon-auth.session_token=abcdefghijklmnop1234567890.sig" } }));
    expect(get?.status).toBe(302);
    expect(get?.headers.get("Location")).toBe("https://scollarly.test/me/apply");
    expect(get?.headers.get("Cache-Control")).toBe("no-store");
    const anonymous = handleApplyForward(new Request("https://scollarly.test/apply"));
    expect(anonymous?.headers.get("Location")).toBe("https://scollarly.test/sign-in?next=%2Fapply");
    // A cookie that is not the session cookie is not a session.
    expect(handleApplyForward(new Request("https://scollarly.test/apply", { headers: { cookie: "theme=dark" } }))?.headers.get("Location")).toBe("https://scollarly.test/sign-in?next=%2Fapply");
    expect(handleApplyForward(new Request("https://scollarly.test/apply", { method: "POST" }))).toBeNull();
    expect(handleApplyForward(new Request("https://scollarly.test/contact"))).toBeNull();
  });
});

describe("S15.4: the sign-in pop-up and its script are gone", () => {
  it("has no gate kinds left, and no public component imports a gate", () => {
    const root = join(process.cwd(), "src");
    expect(existsSync(join(root, "components/public/gate"))).toBe(false);
    expect(existsSync(join(root, "components/public/whatsapp-button.tsx"))).toBe(false);
    expect(existsSync(join(root, "components/public/lead/apply-form.tsx"))).toBe(false);
    expect(existsSync(join(root, "components/public/lead/quick-whatsapp.tsx"))).toBe(false);
    expect(existsSync(join(root, "app/[locale]/(public)/apply"))).toBe(false);
  });
});
