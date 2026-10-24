import { describe, expect, it } from "vitest";
import { auditQuery, watRange } from "@/modules/audit/schema";
import { verifyResponse } from "@/modules/auth/endpoints";
import { INVITE_TOKEN_PATTERN, landingPathFor } from "@/modules/auth/service";
import { emailSchema, inviteBody, removeAdminBody, revokeInviteBody } from "@/modules/team/schema";
import { hashInviteToken, INVITE_TTL_MS, inviteExpiry, inviteLink, inviteState, isUniqueViolation, newInviteToken } from "@/modules/team/service";
import { classifyAuthed } from "@/server/edge/authed";

describe("landingPathFor: where each person goes after Google sign-in", () => {
  it.each([
    [{ storedRole: "student", twoFactorVerified: false, twoFactorEnrolled: false }, "/me"],
    [{ storedRole: "admin", twoFactorVerified: false, twoFactorEnrolled: false }, "/admin"],
    [{ storedRole: "owner", twoFactorVerified: false, twoFactorEnrolled: false }, "/two-factor/enrol"],
    [{ storedRole: "owner", twoFactorVerified: false, twoFactorEnrolled: true }, "/two-factor/verify"],
    [{ storedRole: "owner", twoFactorVerified: true, twoFactorEnrolled: true }, "/admin"],
  ] as const)("%j goes to %s", (input, expected) => {
    expect(landingPathFor(input)).toBe(expected);
  });
});

describe("invite tokens", () => {
  it("are 32 random bytes as 43 base64url characters, never repeated, and match the pattern", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newInviteToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(INVITE_TOKEN_PATTERN);
  });

  it("hash to a stable SHA-256 hex, and a malformed token never reaches the database", async () => {
    const token = newInviteToken();
    expect(await hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashInviteToken(token)).toBe(await hashInviteToken(token));
    for (const bad of ["", "short", `${token}x`, `${token.slice(0, 42)}+`, "../".repeat(15)]) expect(await hashInviteToken(bad), bad).toBeNull();
  });

  it("expire after exactly 7 days, and the link points at the accept page", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(inviteExpiry(now).getTime() - now.getTime()).toBe(INVITE_TTL_MS);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 3_600_000);
    expect(inviteLink("https://scollarly.example", "abc")).toBe("https://scollarly.example/accept-invite/abc");
    expect(inviteState({ expiresAt: new Date(now.getTime() + 1) }, now)).toBe("open");
    expect(inviteState({ expiresAt: now }, now)).toBe("expired");
  });

  it("recognises a unique violation however the driver wraps it", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("team schemas", () => {
  it("lower-case and trim the email, refuse a bad one, an unknown field and a long one", () => {
    expect(inviteBody.parse({ email: "  A.B@Example.TEST " })).toEqual({ email: "a.b@example.test" });
    for (const bad of [{ email: "nope" }, { email: "" }, {}, { email: "a@example.test", role: "owner" }, { email: `${"a".repeat(250)}@example.test` }]) {
      expect(inviteBody.safeParse(bad).success, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
    expect(emailSchema.safeParse(42).success).toBe(false);
  });
  it("need a uuid to revoke and a user id to remove", () => {
    expect(revokeInviteBody.safeParse({ id: "0194f3c2-8a4b-7c1d-9e2f-3a4b5c6d7e8f" }).success).toBe(true);
    expect(revokeInviteBody.safeParse({ id: "1; drop table admin_invite" }).success).toBe(false);
    expect(removeAdminBody.safeParse({ userId: "u1" }).success).toBe(true);
    expect(removeAdminBody.safeParse({ userId: "" }).success).toBe(false);
    expect(removeAdminBody.safeParse({ userId: "u".repeat(65) }).success).toBe(false);
  });
});

describe("audit filters (C5)", () => {
  it("turns WAT days into UTC instants: 2026-10-23 in WAT starts at 23:00 UTC the day before and ends at 23:00 UTC", () => {
    const range = watRange("2026-10-23", "2026-10-23");
    expect(range?.from?.toISOString()).toBe("2026-10-22T23:00:00.000Z");
    expect(range?.to?.toISOString()).toBe("2026-10-23T23:00:00.000Z");
  });
  it("accepts open ranges and refuses impossible dates and a reversed range", () => {
    expect(watRange()).toEqual({});
    expect(watRange("2026-10-23")?.to).toBeUndefined();
    expect(watRange(undefined, "2026-10-23")?.from).toBeUndefined();
    expect(watRange("2026-02-31")).toBeNull();
    expect(watRange("2026-13-01")).toBeNull();
    expect(watRange("2026-05-02", "2026-05-01")).toBeNull();
    expect(watRange("2026-05-01", "2026-05-01")).not.toBeNull();
  });
  it("accepts only the query a screen can produce", () => {
    expect(auditQuery.safeParse({ actor: "u-1", action: "team.invite", from: "2026-10-01", to: "2026-10-31", before: "0194f3c2-8a4b-7c1d-9e2f-3a4b5c6d7e8f" }).success).toBe(true);
    for (const bad of [{ action: "bad action" }, { action: "1bad" }, { from: "yesterday" }, { before: "x" }, { unknown: "1" }, { actor: "a b" }]) {
      expect(auditQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("verifyResponse: how a 2FA result reaches the screen", () => {
  const body = async (r: Response) => (await r.json()) as { error?: { code: string; fields?: Record<string, string> } };
  it("maps every result to a status and a token the screen can translate", async () => {
    expect((await verifyResponse("ok", "r1")).status).toBe(200);
    const invalid = verifyResponse("invalid", "r1");
    expect([invalid.status, (await body(invalid)).error?.fields]).toEqual([400, { code: "INVALID_CODE" }]);
    const replayed = verifyResponse("replayed", "r1");
    expect([replayed.status, (await body(replayed)).error?.fields]).toEqual([400, { code: "CODE_ALREADY_USED" }]);
    const locked = verifyResponse("locked", "r1");
    expect([locked.status, locked.headers.get("retry-after")]).toEqual([429, "900"]);
    const notEnrolled = verifyResponse("not_enrolled", "r1");
    expect([notEnrolled.status, (await body(notEnrolled)).error?.fields]).toEqual([409, { code: "NOT_ENROLLED" }]);
  });
});

describe("the signed-in router now also covers the two-factor pages and data", () => {
  const classify = (path: string) => classifyAuthed("GET", new URL(`https://x.example${path}`), new Headers());
  it("treats /two-factor/* as a shell of area auth, and /api/v1/auth/<name> as its data", () => {
    expect(classify("/two-factor/enrol")).toEqual({ kind: "shell", area: "auth" });
    expect(classify("/en/two-factor/verify")).toEqual({ kind: "shell", area: "auth" });
    expect(classify("/api/v1/auth/two-factor-status")).toEqual({ kind: "api", area: "auth", name: "two-factor-status" });
    expect(classify("/api/v1/invites/check")).toBeNull();
    expect(classify("/two-factors")).toBeNull();
  });
});
