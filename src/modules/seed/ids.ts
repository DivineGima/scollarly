/**
 * Deterministic ids for seeded rows, so running the seed twice finds the same rows and inserts nothing the second time.
 * The id is the first 16 bytes of SHA-256("scollarly-seed:<kind>:<key>") with the version nibble set to 8 (the RFC 9562
 * custom-UUID version) and the variant bits set, so it is a valid UUID that can never collide with a random UUID v7.
 */

const encoder = new TextEncoder();

export async function seedId(kind: string, key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`scollarly-seed:${kind}:${key}`)));
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80; // version 8
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
