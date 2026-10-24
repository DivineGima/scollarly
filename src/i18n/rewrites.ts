import { defaultLocale, locales } from "./config";

/**
 * ADR-018: v1 uses no locale middleware. Routes live under `src/app/[locale]`, and an unprefixed path such as
 * `/universities` is rewritten to `/en/universities` before the file system is checked, so every page works at the
 * clean address. Adding French later is additive: a second locale in `config.ts` and a middleware (or more rewrites).
 *
 * Not rewritten, because they live outside `[locale]` or are files:
 *  - `/api/...` (Route Handlers), `/auth/...` (sign-in steps), `/media/...` (images) and `/_next/...` (build output);
 *  - any path with a dot in it: `/sw.js`, `/manifest.webmanifest`, `/icon.svg`;
 *  - a path that already starts with a locale (`/en`, `/en/...`).
 */
export const NOT_LOCALISED_PREFIXES = ["api/", "auth/", "media/", "_next/"] as const;

/** The `source` pattern of the catch-all rewrite, in Next.js's path-to-regexp syntax. */
export function localeRewriteSource(): string {
  const skip = [...locales.map((locale) => `${locale}(?:/|$)`), ...NOT_LOCALISED_PREFIXES].join("|");
  return `/:path((?!${skip})[^.]+)`;
}

export function localeRewrites(): { source: string; destination: string }[] {
  return [
    { source: "/", destination: `/${defaultLocale}` },
    { source: localeRewriteSource(), destination: `/${defaultLocale}/:path` },
  ];
}
