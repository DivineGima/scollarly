import { beforeEach, describe, expect, it, vi } from "vitest";

const proxy = vi.fn();
vi.mock("@neondatabase/auth/server", () => ({
  handleAuthProxyRequest: (options: unknown) => proxy(options),
  processAuthMiddleware: vi.fn(),
  NEON_AUTH_SESSION_COOKIE_NAME: "__Secure-neon-auth.session_token",
}));

import { startGoogleSignIn } from "@/server/auth/session";

const config = { baseUrl: "https://auth.example/neondb/auth", cookieSecret: "x".repeat(32) };
const start = (cookie?: string) => startGoogleSignIn(new Request("https://scollarly.example/auth/start", { headers: cookie ? { cookie } : {} }), config, "/auth/return");

describe("startGoogleSignIn", () => {
  beforeEach(() => proxy.mockReset());

  it("asks Neon Auth for a Google sign-in that returns to our origin, then redirects to Google with the state cookie", async () => {
    const answer = new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/auth?x=1", redirect: true }), { headers: { "content-type": "application/json" } });
    answer.headers.append("set-cookie", "__Secure-neon-auth.state=abc; Path=/; HttpOnly");
    proxy.mockResolvedValue(answer);

    const response = await start();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/auth?x=1");
    expect(response.headers.get("set-cookie")).toContain("__Secure-neon-auth.state=abc");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const options = proxy.mock.calls[0]?.[0] as { request: Request; path: string };
    expect(options.path).toBe("sign-in/social");
    expect(options.request.method).toBe("POST");
    expect(await options.request.json()).toEqual({ provider: "google", callbackURL: "https://scollarly.example/auth/return" });
  });

  it("follows a redirect answer from Neon Auth as well", async () => {
    proxy.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://accounts.google.com/x" } }));
    expect((await start()).headers.get("location")).toBe("https://accounts.google.com/x");
  });

  it("answers 502 when Neon Auth gives no address, without leaking its answer", async () => {
    proxy.mockResolvedValue(new Response("secret internal error", { status: 500 }));
    const response = await start();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/secret/);
  });
});
