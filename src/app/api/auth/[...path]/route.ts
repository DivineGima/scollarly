import { proxyAuthRequest } from "@/server/auth";
import { getEnv } from "@/server/env";

// Neon Auth owns sign-in and sessions (ADR-037). This route only forwards /api/auth/* to the managed service, so the
// session cookies belong to our own origin. Nothing here decides who may see what: that is the auth facade.
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  const env = getEnv();
  return proxyAuthRequest(request, path.join("/"), { baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET });
}

export const GET = handle;
export const POST = handle;
