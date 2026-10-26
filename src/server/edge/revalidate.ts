import * as z from "zod";
import { errorResponse, errorResponseFor, isSameOrigin, jsonResponse, newRequestId, readJsonBody } from "@/lib/http";
import { CONTENT_TAGS, type ContentArea } from "@/modules/content/tags";
import { AuthError, type Actor } from "@/server/auth/actor";
import { logError } from "@/server/log";
import { isPublicPagePath } from "./fast-path";

/**
 * `POST /api/v1/admin/revalidate` (S6.4, architecture 10.4). A publish is a plain function in the Worker entry and cannot call Next.js'
 * `revalidateTag`, which needs the Next.js server. So the screen makes this one small second request right after a change that
 * touched the public site. It runs through Next.js on purpose, checks the session itself (the facade, an admin or the owner), marks the
 * changed areas stale so the next request regenerates the pages that read them, and drops the changed pages from the edge cache so a
 * visitor does not wait out the 30 second copy (ADR-033). If this request never arrives the site still catches up: the edge copy
 * expires in 30 seconds and the pages regenerate at least hourly (`CONTENT_REVALIDATE_SECONDS`).
 *
 * It is idempotent, so the screen retries it. It carries no personal data.
 */

const AREAS = Object.keys(CONTENT_TAGS) as [ContentArea, ...ContentArea[]];

export const revalidateBody = z.strictObject({
  areas: z.array(z.enum(AREAS)).max(AREAS.length),
  paths: z.array(z.string().max(120)).max(30),
});

export interface RevalidateDeps {
  requireAdmin: (headers: Headers) => Promise<Actor>;
  revalidate: (...areas: ContentArea[]) => void;
  /** Drops one page from the edge cache; resolves to whether a copy was there. */
  purge: (url: string) => Promise<boolean>;
}

export async function handleRevalidate(request: Request, deps: RevalidateDeps): Promise<Response> {
  const requestId = newRequestId();
  if (!isSameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-origin requests are not allowed.", requestId);
  try {
    await deps.requireAdmin(request.headers);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.code === "UNAUTHENTICATED" ? 401 : 403, error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", error.message, requestId);
    logError(requestId, "admin/revalidate", error);
    return errorResponseFor("TEMPORARILY_UNAVAILABLE", "Please try again shortly.", requestId, { headers: { "Retry-After": "5" } });
  }

  const body = await readJsonBody(request, 4096);
  if (!body.ok) return errorResponse(body.reason === "too_large" ? 413 : 400, body.reason === "too_large" ? "PAYLOAD_TOO_LARGE" : "VALIDATION", "Request body must be valid JSON.", requestId);
  const parsed = revalidateBody.safeParse(body.value);
  if (!parsed.success) return errorResponse(400, "VALIDATION", "Check the request.", requestId);

  try {
    deps.revalidate(...parsed.data.areas);
    // Only public pages are ever purged: a path that is not one is ignored, so this cannot be used to touch anything else.
    const origin = new URL(request.url).origin;
    const paths = [...new Set(parsed.data.paths)].filter((path) => path.startsWith("/") && isPublicPagePath(path));
    const purged = await Promise.all(paths.map((path) => deps.purge(`${origin}${path}`)));
    return jsonResponse({ revalidated: parsed.data.areas, purged: purged.filter(Boolean).length });
  } catch (error) {
    logError(requestId, "admin/revalidate", error);
    return errorResponseFor("INTERNAL", "Something went wrong.", requestId);
  }
}
