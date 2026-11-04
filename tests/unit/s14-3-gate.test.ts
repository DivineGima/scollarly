import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GateLink } from "@/components/public/gate/gate-link";
import { intentParams, onboardingPath, readIntent, unconfirmedLanding } from "@/modules/auth/intent";
import { authHref, safeNext } from "@/modules/gate/next";

describe("S14.3: safeNext is an allow-list, never an open redirect", () => {
  it("accepts the public pages and the two parameterised forms", () => {
    expect(safeNext("/apply")).toBe("/apply");
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/universities/alpha-university")).toBe("/universities/alpha-university");
    expect(safeNext("/blog/")).toBe("/blog");
    expect(safeNext("/apply?university=3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe("/apply?university=3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(safeNext("/?course=commerce")).toBe("/?course=commerce");
  });

  it("drops everything else", () => {
    for (const bad of [
      "https://evil.example/", "//evil.example", "/\evil.example", "javascript:alert(1)", "/admin", "/me", "/api/v1/leads", "/sign-in", "/sign-out",
      "/apply?university=x", "/apply?other=1", "/?course=nope", "/apply#x", "/apply\n", "/universities/Bad Slug", "", "apply", null, undefined, `/${"a".repeat(300)}`,
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

describe("S14.3: a gated button is a link to Sign in until the script upgrades it", () => {
  it("renders the safe markup with the real address kept for a signed-in person", () => {
    const html = renderToStaticMarkup(createElement(GateLink, { kind: "apply", href: "/apply", next: "/apply", className: "btn" }, "Apply"));
    expect(html).toContain('href="/sign-in?next=%2Fapply"');
    expect(html).toContain('data-gate="apply"');
    expect(html).toContain('data-gate-href="/apply"');
    expect(html).toContain('data-gate-next="/apply"');
  });
});
