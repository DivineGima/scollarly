/**
 * The public pages that are prerendered and identical for every visitor. It lives in `lib` (not in `server/edge`) because the sign-in return
 * address check (`modules/gate/next.ts`) is also run in the browser and must not pull edge code into a client bundle (review finding 8).
 * `server/edge/fast-path.ts` re-exports these names, so existing imports keep working.
 */

/** Public pages that are prerendered and identical for every visitor. Extend as public pages are added. */
export const PUBLIC_PAGE_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/universities",
  "/campus-tours",
  "/process",
  "/visa",
  "/faq",
  "/about",
  "/blog",
  "/contact",
  "/privacy",
  "/terms",
  "/offline",
  "/sign-in",
  "/sign-out",
]);

/** Pages whose last segment is a slug the content team chose (a university or a post). A slug page that does not exist answers 404, which is never stored. */
const SLUG_PAGE = /^\/(universities|blog)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPublicPagePath(pathname: string): boolean {
  return PUBLIC_PAGE_PATHS.has(pathname) || SLUG_PAGE.test(pathname);
}
