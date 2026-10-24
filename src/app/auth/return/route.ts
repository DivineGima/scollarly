import { SIGNED_IN_LANDING_PATH } from "@/server/edge/sign-in";
import { completeSignIn } from "@/server/auth";
import { getEnv } from "@/server/env";

// Where Google's return trip lands. The Worker entry answers this path itself (src/server/edge/sign-in.ts); this file is the same
// function for `next dev`. It finishes the Neon Auth handshake, sets the session cookies, and redirects into the app.
export async function GET(request: Request): Promise<Response> {
  const env = getEnv();
  return completeSignIn(request, { baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET }, SIGNED_IN_LANDING_PATH);
}
