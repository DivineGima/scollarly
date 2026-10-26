/**
 * Application ids are UUID v7 (architecture 7): time-ordered, so new rows append to the end of the primary key index.
 * Neon's Postgres has no `uuidv7()` before version 18, so the application generates them.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function uuidv7(now: number = Date.now(), random?: Uint8Array): string {
  if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48) throw new RangeError("uuidv7: timestamp out of range");
  const bytes = random ?? crypto.getRandomValues(new Uint8Array(16));
  if (bytes.length < 16) throw new RangeError("uuidv7: need 16 random bytes");
  const b = Uint8Array.from(bytes.subarray(0, 16));

  // 48-bit big-endian millisecond timestamp. Division, not bit shifts: JavaScript shifts are 32-bit.
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70; // version 7
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant 10

  const h = (i: number) => HEX[b[i] ?? 0];
  return `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_ANY.test(value);
}

/**
 * A random (version 4) UUID for the browser. `crypto.randomUUID` exists only from Chrome 92 and Safari 15.4, and a student's phone can be
 * older than that; `getRandomValues` has been there far longer. The idempotency key of a lead comes from here, so a missing
 * `randomUUID` must not stop an application from being sent.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = (i: number) => HEX[b[i] ?? 0];
  return `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}
