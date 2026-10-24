import { completeSignIn } from "@/server/auth";
import { getEnv } from "@/server/env";

// Where Google's return trip lands (the `callbackURL` the sign-in page sends). Finishes the Neon Auth handshake,
// sets the session cookies, and redirects into the app.
export async function GET(request: Request): Promise<Response> {
  const env = getEnv();
  return completeSignIn(request, { baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET }, "/me/phase0");
}
