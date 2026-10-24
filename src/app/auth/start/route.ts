import { startGoogleSignIn } from "@/server/auth";
import { getEnv } from "@/server/env";

// Stage 0 only: open this address to start Google sign-in without a page to click on. The real sign-in page is S2.2.
export async function GET(request: Request): Promise<Response> {
  const env = getEnv();
  return startGoogleSignIn(request, { baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET }, "/auth/return");
}
