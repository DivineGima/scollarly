import { errorResponse, newRequestId } from "@/lib/http";
import { isAllowedAuthRoute, proxyAuthRequest } from "@/server/auth";
import { getEnv } from "@/server/env";

// Neon Auth owns sign-in and sessions (ADR-037). This route only forwards /api/auth/* to the managed service, so the
// session cookies belong to our own origin. Nothing here decides who may see what: that is the auth facade. Only the few routes the
// product uses are forwarded (sign-in is Google only); everything else is a plain 404.
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  const joined = path.join("/");
  if (!isAllowedAuthRoute(request.method, joined)) return errorResponse(404, "NOT_FOUND", "Not found.", newRequestId());
  const env = getEnv();
  return proxyAuthRequest(request, joined, { baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET });
}

export const GET = handle;
export const POST = handle;
