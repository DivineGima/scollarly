import { describe, expect, it } from "vitest";
import { effectiveRole, hasAtLeast, isRole, isStepUpFresh, STEP_UP_WINDOW_MS } from "@/server/auth/actor";

describe("effectiveRole (architecture 9.3)", () => {
  const verified = new Date("2026-10-23T10:00:00Z");

  it("treats an owner whose session has not passed 2FA as a student", () => {
    expect(effectiveRole("owner", null)).toBe("student");
  });

  it("gives an owner owner powers once the session passed 2FA", () => {
    expect(effectiveRole("owner", verified)).toBe("owner");
  });

  it("does not require 2FA of admins or students (owner only, PRD F5)", () => {
    expect(effectiveRole("admin", null)).toBe("admin");
    expect(effectiveRole("student", null)).toBe("student");
  });

  it("falls back to student for an unknown stored value", () => {
    expect(effectiveRole("superuser", verified)).toBe("student");
    expect(effectiveRole(undefined, verified)).toBe("student");
  });
});

describe("isStepUpFresh (10-minute window)", () => {
  const verifiedAt = new Date("2026-10-23T10:00:00.000Z");
  const at = (ms: number) => new Date(verifiedAt.getTime() + ms);

  it("is false when the session never passed a second-factor check", () => {
    expect(isStepUpFresh({ twoFactorVerifiedAt: null }, verifiedAt)).toBe(false);
  });

  it("is true up to and including exactly 10 minutes", () => {
    expect(isStepUpFresh({ twoFactorVerifiedAt: verifiedAt }, at(0))).toBe(true);
    expect(isStepUpFresh({ twoFactorVerifiedAt: verifiedAt }, at(STEP_UP_WINDOW_MS))).toBe(true);
  });

  it("expires one millisecond after 10 minutes and re-prompts", () => {
    expect(isStepUpFresh({ twoFactorVerifiedAt: verifiedAt }, at(STEP_UP_WINDOW_MS + 1))).toBe(false);
  });

  it("rejects a verification time in the future (clock tampering)", () => {
    expect(isStepUpFresh({ twoFactorVerifiedAt: at(5000) }, verifiedAt)).toBe(false);
  });
});

describe("role helpers", () => {
  it("orders student < admin < owner", () => {
    expect(hasAtLeast({ role: "owner" }, "admin")).toBe(true);
    expect(hasAtLeast({ role: "admin" }, "owner")).toBe(false);
    expect(hasAtLeast({ role: "student" }, "admin")).toBe(false);
    expect(hasAtLeast({ role: "student" }, "student")).toBe(true);
  });

  it("recognises only the three roles", () => {
    expect(["student", "admin", "owner"].every(isRole)).toBe(true);
    expect(isRole("moderator")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});
