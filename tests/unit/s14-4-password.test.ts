import { beforeEach, describe, expect, it, vi } from "vitest";

const proxy = vi.fn();
vi.mock("@/server/auth/session", () => ({ proxyAuthRequest: (...args: unknown[]) => proxy(...args) }));
vi.mock("@/server/security/rate-limit", () => ({ createDurableObjectLimiter: () => limiter, limiterKey: async () => "k" }));
const limiter = vi.fn();

import { checkEmail, checkPassword, validateSignIn, validateSignUp } from "@/modules/auth/password";
import { handlePasswordAuth } from "@/server/edge/password-auth";

const env = { NEON_AUTH_BASE_URL: "https://auth.test", NEON_AUTH_COOKIE_SECRET: "x".repeat(32), RATE_LIMITER: {}, RATE_LIMIT_SECRET: "s" } as unknown as CloudflareEnv;

function post(path: string, body: unknown, headers: Record<string, string> = { origin: "https://scollarly.test" }): Request {
  return new Request(`https://scollarly.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("S14.4: the password rules", () => {
  it("checks the email", () => {
    expect(checkEmail("")).toBe("required");
    expect(checkEmail("nobody")).toBe("invalid");
    expect(checkEmail("a b@c.com")).toBe("invalid");
    expect(checkEmail("  Ama@Example.COM ")).toBeNull();
  });

  it("checks the password length, repeats and the email's own name", () => {
    expect(checkPassword("")).toBe("required");
    expect(checkPassword("short1")).toBe("too_short");
    expect(checkPassword("a".repeat(129))).toBe("too_long");
    expect(checkPassword("aaaaaaaaaa")).toBe("weak");
    expect(checkPassword("abababab")).toBe("weak");
    expect(checkPassword("amaboateng", "amaboateng@x.com")).toBe("weak");
    expect(checkPassword("correct horse battery")).toBeNull();
  });

  it("collects every problem of a sign-up, and sign-in only asks for both fields", () => {
    expect(validateSignUp({ name: " ", email: "x", password: "1" })).toEqual({ name: "required", email: "invalid", password: "too_short" });
    expect(validateSignUp({ name: "Ama", email: "ama@x.com", password: "correct horse" })).toEqual({});
    expect(validateSignIn({ email: "ama@x.com", password: "" })).toEqual({ password: "required" });
    expect(validateSignIn({ email: "ama@x.com", password: "anything at all" })).toEqual({});
  });
});

describe("S14.4: the Worker function", () => {
  beforeEach(() => {
    proxy.mockReset();
    limiter.mockReset();
    limiter.mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 });
  });

  it("ignores every other path and method", async () => {
    expect(await handlePasswordAuth(post("/api/auth/sign-out", {}), env)).toBeNull();
    expect(await handlePasswordAuth(new Request("https://scollarly.test/api/auth/sign-in/email"), env)).toBeNull();
  });

  it("refuses a request that is not from our own page", async () => {
    const response = await handlePasswordAuth(post("/api/auth/sign-in/email", { email: "a@b.co", password: "x" }, { origin: "https://evil.example" }), env);
    expect(response?.status).toBe(403);
    expect((await handlePasswordAuth(post("/api/auth/sign-in/email", { email: "a@b.co", password: "x" }, {}), env))?.status).toBe(403);
    expect(proxy).not.toHaveBeenCalled();
  });

  it("returns the field problems before anything is sent on", async () => {
    const response = await handlePasswordAuth(post("/api/auth/sign-up/email", { name: "", email: "bad", password: "1" }), env);
    expect(response?.status).toBe(400);
    const json = (await response?.json()) as { error: { fields: Record<string, string> } };
    expect(json.error.fields).toEqual({ name: "required", email: "invalid", password: "too_short" });
    expect(proxy).not.toHaveBeenCalled();
  });

  it("limits how fast one caller can try", async () => {
    limiter.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 120 });
    const response = await handlePasswordAuth(post("/api/auth/sign-in/email", { email: "a@b.co", password: "pw" }), env);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("120");
    expect(proxy).not.toHaveBeenCalled();
  });

  it("forwards a good sign-in with the email lower-cased and passes the session cookies on", async () => {
    const answer = new Response("{}", { status: 200 });
    answer.headers.append("Set-Cookie", "__Secure-neon-auth.session_token=abc; Path=/; HttpOnly");
    proxy.mockResolvedValue(answer);
    const response = await handlePasswordAuth(post("/api/auth/sign-in/email", { email: " Ama@X.com ", password: "pw" }), env);
    expect(response?.status).toBe(200);
    expect(response?.headers.getSetCookie()).toEqual(["__Secure-neon-auth.session_token=abc; Path=/; HttpOnly"]);
    const [forwarded, path] = proxy.mock.calls[0] as [Request, string];
    expect(path).toBe("sign-in/email");
    expect(await forwarded.json()).toEqual({ email: "ama@x.com", password: "pw" });
  });

  it("answers the same way for a wrong password and an unknown email", async () => {
    proxy.mockResolvedValue(new Response(JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD" }), { status: 401 }));
    const wrong = await handlePasswordAuth(post("/api/auth/sign-in/email", { email: "a@b.co", password: "pw" }), env);
    proxy.mockResolvedValue(new Response(JSON.stringify({ code: "USER_NOT_FOUND" }), { status: 404 }));
    const unknown = await handlePasswordAuth(post("/api/auth/sign-in/email", { email: "z@b.co", password: "pw" }), env);
    expect(wrong?.status).toBe(401);
    expect(unknown?.status).toBe(401);
    const shape = async (response: Response | null | undefined) => {
      const { error } = (await response?.json()) as { error: unknown };
      return error;
    };
    expect(await shape(wrong)).toEqual(await shape(unknown));
  });

  it("answers a refused sign-up with one fixed sentence", async () => {
    proxy.mockResolvedValue(new Response(JSON.stringify({ code: "USER_ALREADY_EXISTS" }), { status: 422 }));
    const response = await handlePasswordAuth(post("/api/auth/sign-up/email", { name: "Ama", email: "a@b.co", password: "correct horse" }), env);
    expect(response?.status).toBe(400);
    const json = (await response?.json()) as { error: { fields: Record<string, string> } };
    expect(json.error.fields).toEqual({ form: "cannot_sign_up" });
  });

  it("answers 503, never a false 'wrong password', when Neon Auth is down", async () => {
    proxy.mockRejectedValue(new Error("down"));
    expect((await handlePasswordAuth(post("/api/auth/sign-in/email", { email: "a@b.co", password: "pw" }), env))?.status).toBe(503);
    proxy.mockResolvedValue(new Response("", { status: 502 }));
    expect((await handlePasswordAuth(post("/api/auth/sign-in/email", { email: "a@b.co", password: "pw" }), env))?.status).toBe(503);
  });
});
