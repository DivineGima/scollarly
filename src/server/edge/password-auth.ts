import { errorResponse, isSameOrigin, jsonResponse, newRequestId, readJsonBody } from "@/lib/http";
import { normaliseEmail, PASSWORD_SIGN_IN_PATH, PASSWORD_SIGN_UP_PATH, validateSignIn, validateSignUp } from "@/modules/auth/password";
import { proxyAuthRequest, type NeonAuthConfig } from "@/server/auth/session";
import { logError } from "@/server/log";
import { createDurableObjectLimiter, limiterKey } from "@/server/security/rate-limit";

/**
 * Email and password sign-up and sign-in (PRD_3 F21, architecture 22.3, ADR-052) as plain functions in the Worker entry, like the Google
 * steps in `sign-in.ts`: the Next.js layer would cost more CPU than the free plan allows. Neon Auth does the real work (it hashes the
 * password and makes the session). This function checks the request, limits how fast one caller can try, forwards it, and answers in one
 * fixed shape, so a wrong password and an unknown email look the same. The session cookies it sets are the ones Google sign-in sets, so the
 * rest of the app (`Actor`, row level security, every data call) is unchanged. A password is never logged and never cached.
 */

const MAX_BODY_BYTES = 2 * 1024;
const LIMIT = 10; // tries per window per caller
const WINDOW_MS = 10 * 60_000;

type Env = Pick<CloudflareEnv, "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET" | "RATE_LIMITER" | "RATE_LIMIT_SECRET">;

const configOf = (env: Env): NeonAuthConfig => ({ baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET });

const UNAVAILABLE = "Sign-in is not available right now. Please try again in a moment.";

/** Returns a response for the two password paths and null for everything else. */
export async function handlePasswordAuth(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "POST") return null;
  const path = new URL(request.url).pathname;
  const signUp = path === PASSWORD_SIGN_UP_PATH;
  if (!signUp && path !== PASSWORD_SIGN_IN_PATH) return null;

  const requestId = newRequestId();
  const origin = request.headers.get("origin");
  if (origin === null || !isSameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-origin requests are not allowed.", requestId);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? errorResponse(413, "PAYLOAD_TOO_LARGE", "Request is too large.", requestId)
      : errorResponse(400, "VALIDATION", "Request body must be valid JSON.", requestId);
  }
  const value = (typeof body.value === "object" && body.value !== null ? body.value : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : "");
  const input = { name: text("name"), email: text("email"), password: text("password") };

  const issues = signUp ? validateSignUp(input) : validateSignIn(input);
  if (Object.keys(issues).length > 0) {
    return errorResponse(400, "VALIDATION", "Check the highlighted details.", requestId, { fields: issues as Record<string, string> });
  }

  const limiter = createDurableObjectLimiter(env.RATE_LIMITER);
  const key = await limiterKey({ route: signUp ? "password-sign-up" : "password-sign-in", ip: request.headers.get("cf-connecting-ip") }, env.RATE_LIMIT_SECRET);
  const decision = await limiter(key, LIMIT, WINDOW_MS);
  if (!decision.allowed) {
    return errorResponse(429, "RATE_LIMITED", "Too many tries. Please wait a few minutes.", requestId, { headers: { "Retry-After": String(decision.retryAfterSeconds) } });
  }

  const email = normaliseEmail(input.email);
  const forwarded = new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: request.headers.get("cookie") ?? "" },
    body: JSON.stringify(signUp ? { name: input.name.trim(), email, password: input.password } : { email, password: input.password }),
  });

  let answer: Response;
  try {
    answer = await proxyAuthRequest(forwarded, signUp ? "sign-up/email" : "sign-in/email", configOf(env));
  } catch (error) {
    logError(requestId, signUp ? "password-sign-up" : "password-sign-in", error);
    return errorResponse(503, "TEMPORARILY_UNAVAILABLE", UNAVAILABLE, requestId);
  }

  if (answer.status >= 500) return errorResponse(503, "TEMPORARILY_UNAVAILABLE", UNAVAILABLE, requestId);
  if (!answer.ok) {
    // One fixed answer, whatever Neon Auth said, so a stranger learns nothing about which emails have an account.
    return signUp
      ? errorResponse(400, "VALIDATION", "We could not create this account. If you already have one, sign in instead.", requestId, { fields: { form: "cannot_sign_up" } })
      : errorResponse(401, "UNAUTHENTICATED", "The email or password is not right.", requestId, { fields: { form: "bad_credentials" } });
  }

  const reply = jsonResponse({ status: "ok" }, 200);
  for (const cookie of answer.headers.getSetCookie()) reply.headers.append("Set-Cookie", cookie);
  return reply;
}
