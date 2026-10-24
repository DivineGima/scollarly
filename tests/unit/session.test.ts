import { describe, expect, it } from "vitest";
import { NEON_AUTH_SESSION_COOKIE_NAME } from "@neondatabase/auth/server";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/server/auth/session";

const COOKIE = "__Secure-neon-auth.session_token";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"; // 32 characters, the shape Better Auth issues
const headers = (cookie?: string) => new Headers(cookie === undefined ? {} : { cookie });

describe("readSessionToken: the opaque Neon Auth session token from the cookie", () => {
  it("returns the token part of `token.signature`", () => {
    expect(readSessionToken(headers(`${COOKIE}=${TOKEN}.c2lnbmF0dXJl`))).toBe(TOKEN);
  });

  it("decodes a URL-encoded value (Better Auth encodes the signature)", () => {
    expect(readSessionToken(headers(`${COOKIE}=${TOKEN}.abc%2Bdef%3D`))).toBe(TOKEN);
  });

  it("finds the cookie among others, in any order, with extra spaces", () => {
    expect(readSessionToken(headers(`a=1;  ${COOKIE}=${TOKEN}.sig ; b=2`))).toBe(TOKEN);
    expect(readSessionToken(headers(`${COOKIE}=${TOKEN}.sig; a=1`))).toBe(TOKEN);
  });

  it("accepts a value without a signature part", () => {
    expect(readSessionToken(headers(`${COOKIE}=${TOKEN}`))).toBe(TOKEN);
  });

  it("returns null when there is no cookie header or no session cookie", () => {
    expect(readSessionToken(headers())).toBeNull();
    expect(readSessionToken(headers("theme=dark; lang=en"))).toBeNull();
    expect(readSessionToken(headers(`${COOKIE}=`))).toBeNull();
  });

  it("ignores look-alike cookies (the legacy name, a prefix match, the cached session_data cookie)", () => {
    expect(readSessionToken(headers(`better-auth.session_token=${TOKEN}.sig`))).toBeNull();
    expect(readSessionToken(headers(`x${COOKIE}=${TOKEN}.sig`))).toBeNull();
    expect(readSessionToken(headers(`__Secure-neon-auth.local.session_data=${TOKEN}.sig`))).toBeNull();
  });

  it("returns null for a malformed token rather than passing it to the database", () => {
    for (const bad of ["short", `${TOKEN}${TOKEN}${TOKEN}`, "has spaces in it 12345678901234", "quote'quote'quote'quote'12345678", "semi;colon;semi;colon;123456789", "%E0%A4%A.sig"]) {
      expect(readSessionToken(headers(`${COOKIE}=${bad}`)), bad).toBeNull();
    }
  });

  it("uses the first matching cookie when the name appears twice", () => {
    const other = "ZyXwVuTsRqPoNmLkJiHgFeDcBa987654";
    expect(readSessionToken(headers(`${COOKIE}=${TOKEN}.s; ${COOKIE}=${other}.s`))).toBe(TOKEN);
  });
});

describe("the cookie name", () => {
  it("is the one the Neon Auth SDK sets (the thin paths read it without importing the SDK)", () => {
    expect(SESSION_COOKIE_NAME).toBe(NEON_AUTH_SESSION_COOKIE_NAME);
  });
});
