import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits), enough to act as the owner's authenticator app in tests. */
export function totpFromUri(totpURI: string, atMs: number = Date.now()): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) throw new Error("no secret in totp uri");
  const counter = Math.floor(atMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (((hmac[offset] ?? 0) & 0x7f) << 24) | (((hmac[offset + 1] ?? 0) & 0xff) << 16) | (((hmac[offset + 2] ?? 0) & 0xff) << 8) | ((hmac[offset + 3] ?? 0) & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
