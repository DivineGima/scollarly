/**
 * S0.4: password hashing variants measured for CPU in one run (architecture section 17).
 *
 *  - "default"      Better Auth's built-in scrypt (JavaScript). Expected to be the heaviest.
 *  - "pbkdf2"       PBKDF2-SHA-256 through WebCrypto (native code). Workers caps iterations at 100,000.
 *  - "passwordless" Google plus an email link (magic link). No password is hashed at all.
 */

export type HashVariant = "default" | "pbkdf2" | "passwordless";

export const HASH_VARIANTS: readonly HashVariant[] = ["default", "pbkdf2", "passwordless"];

export function isHashVariant(value: string): value is HashVariant {
  return (HASH_VARIANTS as readonly string[]).includes(value);
}

/** Cloudflare Workers rejects PBKDF2 iteration counts above 100,000. */
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

const enc = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

/** Constant-time comparison of two equal-purpose byte arrays. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Stored format: `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`. Iterations travel with the hash so they can be raised later. */
export async function hashPasswordPbkdf2(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPasswordPbkdf2(data: { hash: string; password: string }): Promise<boolean> {
  const [scheme, iterRaw, saltB64, hashB64] = data.hash.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterRaw || !saltB64 || !hashB64) return false;
  const iterations = Number.parseInt(iterRaw, 10);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const expected = fromBase64(hashB64);
  const actual = await derive(data.password, fromBase64(saltB64), iterations);
  return timingSafeEqual(actual, expected);
}
