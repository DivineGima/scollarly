/// <reference lib="webworker" />
import { CacheFirst, ExpirationPlugin, NetworkOnly, type PrecacheEntry, Serwist, type SerwistGlobalConfig, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * S0.8 service worker. Production rules (install prompt, queue sync) arrive in S4.1; the rules that must
 * hold from day one are already here: private areas are NETWORK ONLY and never cached (architecture 11.1).
 */
const NEVER_CACHE = /^\/(admin|me|api|sign-in|sign-up|verify-email|forgot-password|reset-password|accept-invite|two-factor)(\/|$)/;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    { matcher: ({ url, sameOrigin }) => sameOrigin && NEVER_CACHE.test(url.pathname), handler: new NetworkOnly() },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/media/"),
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

serwist.addEventListeners();
