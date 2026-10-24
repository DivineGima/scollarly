/**
 * Lead references (ADR-006, architecture 10.1). Generated on the device so a lead can be created offline:
 * 10 characters of Crockford base32 (50 bits), shown as `SC-XXXXX-XXXXX`.
 */

export const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REF_LENGTH = 10;
export const REF_PREFIX = "SC";
/** The canonical, stored and shown form. Crockford base32 has no I, L, O or U. */
export const REF_PATTERN = /^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

/** Formats ten alphabet characters as `SC-XXXXX-XXXXX`. */
export function formatRef(raw: string): string {
  if (raw.length !== REF_LENGTH || [...raw].some((c) => !REF_ALPHABET.includes(c))) {
    throw new RangeError("formatRef: expected 10 Crockford base32 characters");
  }
  return `${REF_PREFIX}-${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * A fresh random reference. 256 is a multiple of 32, so masking one random byte to 5 bits is uniform (no modulo bias).
 * `random` is injectable for tests.
 */
export function generateRef(random: (length: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(REF_LENGTH);
  if (bytes.length < REF_LENGTH) throw new RangeError("generateRef: not enough random bytes");
  let raw = "";
  for (let i = 0; i < REF_LENGTH; i++) raw += REF_ALPHABET[(bytes[i] ?? 0) & 31];
  return formatRef(raw);
}

/**
 * Reads a reference a person typed or copied (any case, spaces, dashes, a missing prefix). Crockford's reading rules
 * apply: O is 0, and I and L are 1. Returns the canonical form, or null when it is not a valid reference.
 */
export function parseRef(input: string): string | null {
  let s = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (s.length === REF_LENGTH + REF_PREFIX.length && s.startsWith(REF_PREFIX)) s = s.slice(REF_PREFIX.length);
  if (s.length !== REF_LENGTH) return null;
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  return [...s].every((c) => REF_ALPHABET.includes(c)) ? formatRef(s) : null;
}
