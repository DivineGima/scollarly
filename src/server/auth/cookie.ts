/**
 * The Neon Auth session cookie, read without the Neon Auth SDK. This file is imported by the Worker entry's thin
 * paths (ADR-040), which must stay small, so it holds no SDK import. A unit test checks the name against the SDK's constant.
 */
export const SESSION_COOKIE_NAME = "__Secure-neon-auth.session_token";
const TOKEN_PATTERN = /^[A-Za-z0-9]{16,64}$/;

/**
 * Reads the opaque session token from the Neon Auth session cookie. Better Auth stores `token.signature`
 * (URL-encoded); the token is the part before the first dot. A malformed value gives null, never an error.
 * The signature is not checked here: the token is a long random value that must exist in the database
 * (`app_resolve_session`), so a forged cookie cannot match a session.
 */
export function readSessionToken(headers: Headers): string | null {
  const header = headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    let value = part.slice(separator + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
    const token = value.split(".")[0] ?? "";
    return TOKEN_PATTERN.test(token) ? token : null;
  }
  return null;
}
