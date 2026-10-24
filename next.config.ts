import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";
import { localeRewrites } from "./src/i18n/rewrites";
import { securityHeaderList } from "./src/lib/security-headers";

// Lets `next dev` read Worker bindings (getCloudflareContext). Guarded because it starts a local Miniflare
// (workerd) process, which must not run during `next build`: it slows the build and can keep it from exiting.
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Serwist's webpack plugin builds the service worker. Next 15 builds with webpack by default.
// The service worker is disabled in dev so it never caches while developing.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // Serwist's default reloads the page whenever the phone reconnects. That would wipe a half-filled
  // application form just as a student's signal returns, so it is off. Reconnects are handled by the
  // lead queue's sync engine (S4.2), which retries without touching the page.
  reloadOnOnline: false,
  // `/offline` is served by a rewrite to `/en/offline`, so precache the public URL.
  additionalPrecacheEntries: [{ url: "/offline", revision: process.env.NEXT_PUBLIC_BUILD_ID ?? "phase0" }],
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // ADR-018: no locale middleware. Unprefixed paths are rewritten to `/en/...` (S1.6, src/i18n/rewrites.ts).
  async rewrites() {
    return { beforeFiles: localeRewrites(), afterFiles: [], fallback: [] };
  },
  // Architecture 13.1. The Worker entry adds the same headers to every response, including the ones that never reach Next.js.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaderList() }];
  },
};

export default withSerwist(withNextIntl(nextConfig));
