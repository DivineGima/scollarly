import { locales } from "../i18n/config";

/**
 * What the service worker may and may not keep (architecture 11.1, S4.1). The matchers are plain functions of a path so a unit
 * test can prove the rules without a browser.
 *
 * Network only, never cached: the signed-in areas, the sign-in and sign-out pages and steps, the invite page, the two-factor
 * pages and every API route. The offline copy of the student portal is not a cached page; it is the small IndexedDB
 * `progressSnapshot` record (architecture 11.2).
 */
export const NEVER_CACHE = new RegExp(
  // A page can also be reached under its locale prefix (`/en/admin`, `/en/accept-invite/<token>`); the rule covers both.
  `^(?:/(?:${locales.join("|")}))?/(admin|me|api|auth|sign-in|sign-out|sign-up|verify-email|forgot-password|reset-password|accept-invite|two-factor|account)(/|$)`,
);

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

/**
 * The signed-in shells the service worker may keep and serve only when the network fails (architecture 21.11, ADR-047). A shell is the
 * data-free page of a signed-in route: the same HTML for everyone, nothing private in it. The student app's pages, and the staff's four tabs
 * with Notifications and Profile (S13.6). The sign-in, sign-out and account pages, the questionnaire's API and every `/api/*`
 * route are not shells and are never kept.
 */
export const KEPT_SHELL = new RegExp(`^(?:/(?:${locales.join("|")}))?/(?:me(?:/(?:universities|progress|help|notifications|profile|data|link-application|onboarding))?|admin(?:/(?:leads|content|insights|notifications|profile))?)/?$`);

export function isKeptShell(pathname: string): boolean {
  return KEPT_SHELL.test(pathname);
}

/** The cache the kept shells live in: dropped when a new worker takes over (a new deploy) and on sign-out. */
export const KEPT_SHELL_CACHE = "signed-in-shells";

/** The marker the Worker puts on a signed-in shell it serves, and the only thing that lets the service worker keep a page. */
export const SHELL_HEADER = "x-app-shell";

/** The key a shell is kept under: the path without a trailing slash and without the query, so every visit to a tab finds the same copy. */
export function shellKey(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
}

export interface KeptShellDeps {
  fetch: (request: Request) => Promise<Response>;
  /** The kept-shell cache (`caches.open(KEPT_SHELL_CACHE)`). */
  cache: () => Promise<Pick<Cache, "put" | "match">>;
}

/**
 * Network first, and the copy only when the network fails. A page is kept only when the Worker said it is a signed-in shell
 * (`x-app-shell`): an error page, a sign-in redirect or a 404 for a signed-out visitor is never kept. The copy holds nothing private.
 * When the network fails and nothing is kept, the original error is thrown so the service worker's `/offline` fallback applies.
 */
export async function keptShellResponse(request: Request, url: URL, deps: KeptShellDeps): Promise<Response> {
  const key = shellKey(url);
  try {
    const response = await deps.fetch(request);
    if (response.ok && response.headers.get(SHELL_HEADER) === "1") await (await deps.cache()).put(key, response.clone());
    return response;
  } catch (error) {
    const kept = await (await deps.cache()).match(key);
    if (kept) return kept;
    throw error;
  }
}
