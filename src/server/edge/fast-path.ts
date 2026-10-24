/**
 * Edge fast path (spike for the Workers Free CPU limit).
 *
 * Measured in Stage 0: a prerendered public page served through OpenNext costs about 7 to 9 ms of CPU, and an image
 * cache hit about 10 ms, because the whole Next.js server layer starts for every request. The free plan allows about 10 ms.
 * This module lets the Worker entry answer those requests straight from the Cache API (a few milliseconds at most)
 * and only fall through to Next.js on a miss.
 *
 * Only public, cookie-free, GET requests are ever served or stored here. Nothing under /admin, /me, /api or
 * /_next is touched, so private data can never enter this cache.
 */

export type FastPathKind = "page" | "media";

/** Public pages that are prerendered and identical for every visitor. Extend as public pages are added. */
export const PUBLIC_PAGE_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/universities",
  "/fees",
  "/campus-tours",
  "/process",
  "/visa",
  "/faq",
  "/about",
  "/blog",
  "/contact",
  "/apply",
  "/privacy",
  "/terms",
  "/offline",
  "/phase0/published",
  "/sign-in",
  "/sign-out",
]);

/** Pages whose last segment is a slug the content team chose (a university or a post). A slug page that does not exist answers 404, which is never stored. */
const SLUG_PAGE = /^\/(universities|blog)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPublicPagePath(pathname: string): boolean {
  return PUBLIC_PAGE_PATHS.has(pathname) || SLUG_PAGE.test(pathname);
}

const MEDIA_PATH = /^\/media\/([a-f0-9]{64})(?:\.webp)?$/;

/** How long a public page may be served from the edge cache before Next.js regenerates it. This is the "publish shows up within" time. */
export const PAGE_EDGE_TTL_SECONDS = 30;

export function classify(method: string, url: URL, hasCookieHeader: boolean): FastPathKind | null {
  if (method !== "GET") return null;
  if (MEDIA_PATH.test(url.pathname)) return "media"; // immutable by content hash, so cookies are irrelevant
  if (isPublicPagePath(url.pathname) && !hasCookieHeader) return "page";
  return null;
}

/** One canonical key per page or image, whatever query string was sent (utm tags, cache busters). */
export function cacheKey(url: URL, kind: FastPathKind): Request {
  const path = kind === "media" ? `/media/${MEDIA_PATH.exec(url.pathname)?.[1]}.webp` : url.pathname;
  return new Request(`${url.origin}${path}`);
}

type CacheLike = Pick<Cache, "match" | "put">;

/** A response is only stored if it is a plain, successful, cookie-free HTML page. */
export function isStorablePage(response: Response): boolean {
  return (
    response.status === 200 &&
    !response.headers.has("set-cookie") &&
    (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")
  );
}

/** Cache copy of a page with an explicit short lifetime, so a publish becomes visible within PAGE_EDGE_TTL_SECONDS. */
export function toEdgeCopy(response: Response): Response {
  const copy = new Response(response.body, response);
  copy.headers.set("Cache-Control", `public, max-age=0, s-maxage=${PAGE_EDGE_TTL_SECONDS}`);
  copy.headers.set("X-Edge-Cache", "stored");
  return copy;
}

export interface FastPathDeps {
  cache: CacheLike;
  /** Runs the normal (Next.js) handler. */
  next: () => Promise<Response>;
  waitUntil: (task: Promise<unknown>) => void;
}

/**
 * Serves from the edge cache when it can. For pages, a miss runs `next` once and stores a copy. For images, a miss
 * simply falls through: the image route stores the bytes itself after reading them from the database.
 */
export async function serveFastPath(request: Request, kind: FastPathKind, { cache, next, waitUntil }: FastPathDeps): Promise<Response> {
  const key = cacheKey(new URL(request.url), kind);
  const hit = await cache.match(key);
  if (hit) return hit;

  const response = await next();
  if (kind === "page" && isStorablePage(response)) waitUntil(cache.put(key, toEdgeCopy(response.clone())));
  return response;
}
