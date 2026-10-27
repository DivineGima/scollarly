/// <reference lib="webworker" />
import { CacheFirst, ExpirationPlugin, NetworkOnly, type PrecacheEntry, Serwist, type SerwistGlobalConfig, StaleWhileRevalidate } from "serwist";
import { isBuildAsset, isMediaImage, isNeverCached } from "../lib/sw-rules";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * The service worker (S0.8, S4.1; architecture 11.1). The rules, in order:
 *
 *  1. Network only, never cached: `/admin`, `/me`, the auth pages and steps, and `/api/*` (src/lib/sw-rules.ts).
 *  2. `/_next/static/*` (content-hashed build files): cache first, so a page that was opened once still runs its code, and the
 *     lead forms work offline.
 *  3. `/media/*` (content-hashed images): cache first, bounded to 60 entries.
 *  4. Public HTML pages: stale while revalidate, so the next visit shows what was fetched last time.
 *  5. When a page cannot be fetched and is not cached: `/offline`, which is precached.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    { matcher: ({ url, sameOrigin }) => sameOrigin && isNeverCached(url.pathname), handler: new NetworkOnly() },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && isBuildAsset(url.pathname),
      handler: new CacheFirst({ cacheName: "static", plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600 })] }),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && isMediaImage(url.pathname),
      handler: new CacheFirst({ cacheName: "media", plugins: [new ExpirationPlugin({ maxEntries: 60 })] }),
    },
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.destination === "document",
      handler: new StaleWhileRevalidate({ cacheName: "pages" }),
    },
  ],
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

// A new deploy means new build files. A page kept from the previous deploy points at code that may no longer exist, and
// the visitor then sees "Application error: a client-side exception". The strategy stays stale-while-revalidate
// (architecture 11.1); the kept pages are dropped when a new worker takes over, so the first visit after a deploy is fresh.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete("pages"));
});

serwist.addEventListeners();
