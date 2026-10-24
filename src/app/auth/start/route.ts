import { SIGN_IN_RETURN_PATH } from "@/server/edge/sign-in";
import { startGoogleSignIn } from "@/server/auth";
import { getEnv } from "@/server/env";

// Stage 0 only. The Worker entry answers this path itself (src/server/edge/sign-in.ts); this file is the same function for `next dev`.
export async function GET(request: Request): Promise<Response> {
  const env = getEnv();
  return startGoogleSignIn(request, { baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET }, SIGN_IN_RETURN_PATH);
}
