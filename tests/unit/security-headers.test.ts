import { describe, expect, it } from "vitest";
import { applySecurityHeaders, CSP, SECURITY_HEADERS, securityHeaderList } from "@/lib/security-headers";

describe("security headers (architecture 13.1)", () => {
  it("has every header the architecture lists", () => {
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(SECURITY_HEADERS["Permissions-Policy"]).toMatch(/geolocation=\(\)/);
    expect(SECURITY_HEADERS["Permissions-Policy"]).toMatch(/microphone=\(\)/);
  });

  it("enforces the full policy (S11.1) and no longer sends a report-only copy", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toBe(CSP);
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("the policy matches the architecture: youtube-nocookie and Turnstile frames, same-origin connections, self, data and blob images", () => {
    const directives: Record<string, string[]> = Object.fromEntries(CSP.split("; ").map((d) => [d.split(" ")[0] ?? "", d.split(" ").slice(1)]));
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(directives["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    // `https:` is for the tapped 360 tour frame: staff enter any https tour address (the seeded tours are on other hosts), and a list of hosts would block them.
    expect(directives["frame-src"]).toEqual(expect.arrayContaining(["https://www.youtube-nocookie.com", "https://challenges.cloudflare.com", "https:"]));
    expect(directives["frame-src"]).not.toContain("http:");
    expect(directives["frame-src"]).not.toContain("*");
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["base-uri"]).toEqual(["'self'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    // The one accepted gap, written down: inline scripts stay allowed because a nonce needs a dynamic render (ADR-033).
    expect(directives["script-src"]).toContain("'unsafe-inline'");
    expect(directives["script-src"]).not.toContain("'unsafe-eval'");
    expect(directives["object-src"]).toEqual(["'none'"]);
    // No third-party script origin other than Turnstile (CLAUDE.md: no third-party scripts).
    expect(directives["script-src"]?.filter((s) => s.startsWith("https://"))).toEqual(["https://challenges.cloudflare.com"]);
  });

  it("securityHeaderList is the same set in Next.js's format", () => {
    const list = securityHeaderList();
    expect(list.length).toBe(Object.keys(SECURITY_HEADERS).length);
    for (const { key, value } of list) expect(SECURITY_HEADERS[key]).toBe(value);
  });
});

describe("applySecurityHeaders", () => {
  it("adds the headers and keeps status, body and the other headers", async () => {
    const out = applySecurityHeaders(new Response("hello", { status: 201, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } }));
    expect(out.status).toBe(201);
    expect(await out.text()).toBe("hello");
    expect(out.headers.get("content-type")).toBe("text/plain");
    expect(out.headers.get("cache-control")).toBe("no-store");
    for (const name of Object.keys(SECURITY_HEADERS)) expect(out.headers.get(name), name).toBe(SECURITY_HEADERS[name]);
  });

  it("does not overwrite a header the response already set", () => {
    const out = applySecurityHeaders(new Response("x", { headers: { "X-Frame-Options": "SAMEORIGIN" } }));
    expect(out.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(out.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("returns the same response when nothing is missing, and works on a redirect", () => {
    const full = new Response("x", { headers: SECURITY_HEADERS });
    expect(applySecurityHeaders(full)).toBe(full);
    const redirect = applySecurityHeaders(Response.redirect("https://example.test/next", 302));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://example.test/next");
    expect(redirect.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("works on a response whose headers are immutable", () => {
    const immutable = new Response("x");
    Object.defineProperty(immutable.headers, "set", { value: () => { throw new TypeError("immutable"); } });
    expect(() => applySecurityHeaders(immutable)).not.toThrow();
  });
});
