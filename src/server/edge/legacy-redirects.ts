/**
 * Old admin addresses that become sections of a hub (architecture 21.5, ADR-049). A tiny map checked in the Worker entry before the
 * session check: it reveals nothing, and the address it sends the browser to enforces the session. It answers `301` and keeps the
 * locale prefix and any query the old address carried.
 *
 * Built in S13.1 and wired into `worker/index.ts` in S13.6, in the same change that adds the hubs. Wiring it earlier would send
 * people to screens that do not exist yet.
 */

import { readSessionToken } from "@/server/auth/cookie";

interface Target {
  path: string;
  view: string;
}

const MAP: Readonly<Record<string, Target>> = {
  "/admin/leads/link-requests": { path: "/admin/leads", view: "link-requests" },
  "/admin/data-requests": { path: "/admin/leads", view: "data-requests" },
  "/admin/content/stale": { path: "/admin/content", view: "stale" },
  "/admin/content/media": { path: "/admin/content", view: "media" },
  "/admin/analytics": { path: "/admin/insights", view: "funnel" },
  "/admin/analytics/performance": { path: "/admin/insights", view: "performance" },
  "/admin/payments": { path: "/admin/insights", view: "payments" },
};

/** Public pages that were removed. Fees are no longer shown anywhere (PRD_3 F-fees, ADR-054); the old address moves to the universities list. */
const MOVED: Readonly<Record<string, string>> = { "/fees": "/universities" };

const LOCALE_PREFIX = /^(\/en)(?=\/)/;

/** The address an old one moves to, or null when the address was never moved. Pure, so it is unit-tested without a Worker. */
export function legacyTarget(pathname: string, search: string): string | null {
  const prefix = LOCALE_PREFIX.exec(pathname)?.[1] ?? "";
  const path = pathname.slice(prefix.length).replace(/\/+$/, "");
  const moved = MOVED[path];
  if (moved) return `${prefix}${moved}`;
  const target = MAP[path];
  if (!target) return null;
  const params = new URLSearchParams(search);
  params.set("view", target.view);
  return `${prefix}${target.path}?${params.toString()}`;
}

/**
 * Where the old public Apply address goes (PRD_4 F24, architecture 23.5). Applying lives inside the account now, so `/apply` is not a page
 * any more: a browser with a session cookie goes to the Apply screen, anyone else to Sign in with `/apply` as the place to return to (after
 * sign-in, and onboarding for a new account, the same forward takes them to the Apply screen). No database call: whether the session is
 * real is decided by the screen it lands on. Pure, so it is unit-tested without a Worker.
 */
export function applyForwardTarget(pathname: string, hasSessionCookie: boolean): string | null {
  const prefix = LOCALE_PREFIX.exec(pathname)?.[1] ?? "";
  const path = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (path !== "/apply") return null;
  return hasSessionCookie ? `${prefix}/me/apply` : `${prefix}/sign-in?next=${encodeURIComponent("/apply")}`;
}

/** `GET` and `HEAD` only. `302`, never stored: the answer depends on the cookie. Null for every other address. */
export function handleApplyForward(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const to = applyForwardTarget(url.pathname, readSessionToken(request.headers) !== null);
  if (to === null) return null;
  return new Response(null, { status: 302, headers: { Location: new URL(to, url.origin).toString(), "Cache-Control": "no-store" } });
}

/** `GET` and `HEAD` only. Returns a response for an old address and null for everything else, so the Worker carries on as before. */
export function handleLegacyRedirect(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const to = legacyTarget(url.pathname, url.search);
  if (to === null) return null;
  return new Response(null, { status: 301, headers: { Location: new URL(to, url.origin).toString(), "Cache-Control": "public, max-age=3600" } });
}
