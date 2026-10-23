import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/server/security/turnstile";

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("verifyTurnstile", () => {
  it("returns ok when Cloudflare says success", async () => {
    expect(await verifyTurnstile("secret", "token", reply({ success: true }))).toBe("ok");
  });

  it("returns failed when Cloudflare rejects the token", async () => {
    expect(await verifyTurnstile("secret", "token", reply({ success: false, "error-codes": ["invalid-input-response"] }))).toBe("failed");
  });

  it("returns failed for an empty token without calling Cloudflare", async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstile("secret", "", fetchImpl)).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns unavailable when Cloudflare errors or the call throws, so the client retries", async () => {
    expect(await verifyTurnstile("secret", "token", reply({}, 500))).toBe("unavailable");
    const failing = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile("secret", "token", failing)).toBe("unavailable");
  });

  it("does not treat a truthy non-true success value as success", async () => {
    expect(await verifyTurnstile("secret", "token", reply({ success: "true" }))).toBe("failed");
  });

  it("sends the secret and token but never an IP address", async () => {
    const fetchImpl = reply({ success: true });
    await verifyTurnstile("the-secret", "the-token", fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get("secret")).toBe("the-secret");
    expect(form.get("response")).toBe("the-token");
    expect(form.has("remoteip")).toBe(false);
  });
});
