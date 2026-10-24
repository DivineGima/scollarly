/**
 * What the service worker may and may not keep (architecture 11.1, S4.1). The matchers are plain functions of a path so a unit
 * test can prove the rules without a browser.
 *
 * Network only, never cached: the signed-in areas, the sign-in and sign-out pages and steps, the invite page, the two-factor
 * pages and every API route. The offline copy of the student portal is not a cached page; it is the small IndexedDB
 * `progressSnapshot` record (architecture 11.2).
 */
export const NEVER_CACHE = /^\/(admin|me|api|auth|sign-in|sign-out|sign-up|verify-email|forgot-password|reset-password|accept-invite|two-factor)(\/|$)/;

export function isNeverCached(pathname: string): boolean {
  return NEVER_CACHE.test(pathname);
}

/** Content-hashed build files (`/_next/static/...`): safe to keep forever, and needed for the forms to work offline. */
export function isBuildAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/static/");
}

/** Content-hashed images (`/media/<sha256>.webp`): cache first, bounded to 60 entries. */
export function isMediaImage(pathname: string): boolean {
  return pathname.startsWith("/media/");
}
