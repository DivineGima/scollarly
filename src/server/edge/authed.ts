import { errorResponse, jsonResponse, newRequestId } from "@/lib/http";
import { logError } from "@/server/log";
import { type Actor, AuthError, hasAtLeast, type Role } from "@/server/auth/actor";
import { readSessionToken } from "@/server/auth/cookie";
import { isStorablePage, toEdgeCopy } from "./fast-path";

/**
 * Signed-in screens on the free plan (ADR-040, owner decision D18). A page rendered by Next.js costs 13 to 15 ms of CPU
 * against a 10 ms limit (Stage 0 measured 15 ms for the staff page), so a signed-in screen is two cheap requests that never start Next.js
 * for the data:
 *
 *  1. The shell: the HTML of the screen with no data in it, identical for everyone, prerendered by Next.js once and kept
 *     in the Cache API. The edge checks the session first and answers 404 to anyone who may not use the area.
 *  2. The data: `GET /api/v1/<area>/<name>`, a plain function that checks the session, runs its queries under row
 *     level security and returns JSON. The shell fetches it.
 *
 * Both run in the Worker entry. Access control is still the facade (`checkSession`, `hasAtLeast`) and row level
 * security under it (ADR-038); it is not in middleware. The shell holds nothing private, so a cached copy can never leak data.
 */

export type Area = "admin" | "me" | "auth";

/**
 * The role an area needs. `me` and `auth` are any signed-in user. `auth` holds the two-factor pages and their data: an
 * owner who has not passed 2FA is treated as a student, so those pages must be open to a student-level session, and the
 * data call itself then checks that the account is the owner.
 */
export const AREA_ROLE: Record<Area, Role> = { admin: "admin", me: "student", auth: "student" };

const SHELL_PATH = /^\/(?:en\/)?(admin|me|two-factor)(?:\/.*)?$/;
const API_PATH = /^\/api\/v1\/(admin|me|auth)\/([a-z0-9-]+)$/;
const SHELL_AREA: Record<string, Area> = { admin: "admin", me: "me", "two-factor": "auth" };

/**
 * A screen for one record (`/admin/leads/<id>`) is still one shell: it has no data in it, and the screen reads the id from the
 * address. So every id shares one cached copy, kept under a fixed placeholder path, instead of one prerender per lead.
 */
const RECORD_SHELL = /^(\/(?:en\/)?admin\/leads)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
export const RECORD_SHELL_PLACEHOLDER = "_";

/** The edit screen of a content item (`/admin/content/<type>/<id>`, or `/new` for a new one): one shell per type, prerendered under the placeholder. */
const CONTENT_SHELL = /^(\/(?:en\/)?admin\/content\/[a-z]+)\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|new)\/?$/i;

export function canonicalShellPath(pathname: string): string {
  const match = RECORD_SHELL.exec(pathname) ?? CONTENT_SHELL.exec(pathname);
  return match ? `${match[1]}/${RECORD_SHELL_PLACEHOLDER}` : pathname;
}

export type AuthedRoute = { kind: "shell"; area: Area } | { kind: "api"; area: Area; name: string };

/** Plain HTML navigations only. Next.js client-side (RSC) requests, other methods and unknown paths are not handled here. */
export function classifyAuthed(method: string, url: URL, headers: Headers): AuthedRoute | null {
  if (method !== "GET") return null;
  const api = API_PATH.exec(url.pathname);
  if (api) return { kind: "api", area: api[1] as Area, name: api[2] as string };
  const shell = SHELL_PATH.exec(url.pathname);
  if (shell && !headers.has("rsc") && !url.searchParams.has("_rsc")) return { kind: "shell", area: SHELL_AREA[shell[1] as string] as Area };
  return null;
}

/** What a data call may need besides the actor: the session token (for the few functions keyed by it) and the request URL (filters). */
export interface CallContext {
  token: string | null;
  url: URL;
}

export type DataCall = (actor: Actor, call: CallContext) => Promise<unknown>;

export interface AuthedDeps {
  /** The facade's `checkSession`: one database query. */
  checkSession: (headers: Headers) => Promise<Actor | null>;
  cache: Pick<Cache, "match" | "put">;
  /** Runs the normal (Next.js) handler for a shell miss. It receives a request with no cookies. */
  next: (request: Request) => Promise<Response>;
  waitUntil: (task: Promise<unknown>) => void;
  /** Data functions by `<area>/<name>`. Each runs its queries inside `inContext` for the given actor. */
  api: Record<string, DataCall>;
}

/**
 * Returns a response, or null when the request is not one of ours (the Worker entry then continues as before).
 * `makeDeps` is called only for our requests, so every other request pays nothing for the database handle.
 */
export async function handleAuthed(request: Request, makeDeps: () => AuthedDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const route = classifyAuthed(request.method, url, request.headers);
  if (!route) return null;
  const deps = makeDeps();
  if (route.kind === "api" && !deps.api[`${route.area}/${route.name}`]) return null;

  const requestId = newRequestId();
  let actor: Actor | null;
  try {
    actor = await deps.checkSession(request.headers);
  } catch (error) {
    logError(requestId, `${route.area}/${route.kind === "api" ? route.name : "shell"}`, error);
    return route.kind === "shell" ? notFound() : errorResponse(503, "TEMPORARILY_UNAVAILABLE", "Please try again shortly.", requestId);
  }
  const allowed = actor !== null && hasAtLeast(actor, AREA_ROLE[route.area]);

  if (route.kind === "shell") return allowed ? serveShell(request, url, deps) : notFound();

  if (!actor) return errorResponse(401, "UNAUTHENTICATED", "Sign in required.", requestId);
  if (!allowed) return errorResponse(403, "FORBIDDEN", "Not allowed.", requestId);
  try {
    const call = deps.api[`${route.area}/${route.name}`] as DataCall;
    const result = await call(actor, { token: readSessionToken(request.headers), url });
    // A data call may answer with its own response (for example a 400 for a filter the screen could not have produced).
    return result instanceof Response ? result : jsonResponse(result);
  } catch (error) {
    // A data call may refuse (for example, the Team page is for the owner only). Anything else is a fault: no detail leaves the server.
    if (error instanceof AuthError) {
      return error.code === "UNAUTHENTICATED"
        ? errorResponse(401, "UNAUTHENTICATED", error.message, requestId)
        : errorResponse(403, "FORBIDDEN", error.message, requestId);
    }
    logError(requestId, `${route.area}/${route.name}`, error);
    return errorResponse(500, "INTERNAL", "Something went wrong.", requestId);
  }
}

async function serveShell(request: Request, original: URL, deps: AuthedDeps): Promise<Response> {
  const url = new URL(original);
  url.pathname = canonicalShellPath(original.pathname);
  const key = new Request(`${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`);
  const hit = await deps.cache.match(key);
  if (hit) return privateCopy(hit);

  // Forward only the URL, never the cookie: the shell must be the same for everyone.
  const response = await deps.next(new Request(url, { method: "GET", headers: { accept: request.headers.get("accept") ?? "text/html" } }));
  if (isStorablePage(response)) deps.waitUntil(deps.cache.put(key, toEdgeCopy(response.clone())));
  return privateCopy(response);
}

/** Whatever the stored copy says, a signed-in screen is never shared by a browser cache or the CDN. */
function privateCopy(response: Response): Response {
  const copy = new Response(response.body, response);
  copy.headers.set("Cache-Control", "private, no-store");
  copy.headers.delete("X-Edge-Cache");
  return copy;
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
