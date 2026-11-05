import { expect, test, type BrowserContext } from "@playwright/test";

/**
 * Stage 4 in a real browser (production build, content from the test snapshot): analytics events and install. The public Apply form and the
 * quick WhatsApp form that this file used to drive were removed in S15.4 (PRD_4 F24, F26): an application is made inside the account, and the
 * offline application is driven by tests/e2e/s15-3-apply.spec.ts. What a lead is and how a retry never makes a second one is proven in
 * tests/integration/stage4-leads.test.ts, tests/integration/s15-3-apply.test.ts and tests/unit/offline-engines.test.ts.
 * The Worker is not there under `next start`, so `/api/v1/events` is answered by a small in-memory server.
 */

test.use({ serviceWorkers: "block" });

interface FakeServer {
  events: Record<string, unknown>[][];
}

async function install(context: BrowserContext): Promise<FakeServer> {
  const server: FakeServer = { events: [] };
  await context.route("**/api/v1/events", async (route) => {
    server.events.push((route.request().postDataJSON() as { events: Record<string, unknown>[] }).events);
    return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) });
  });
  return server;
}

test.describe("analytics events (S4.5) and install (S4.1)", () => {
  test("page views travel together, as counts only: no name, number or address, only the allowed fields", async ({ page, context }) => {
    const server = await install(context);
    for (const path of ["/", "/faq", "/about", "/process", "/visa", "/universities"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    await expect.poll(() => server.events.flat().length).toBeGreaterThanOrEqual(5);
    const events = server.events.flat();
    expect(events.every((e) => e.type === "page_view")).toBe(true);
    const allowed = new Set(["type", "occurred_at", "session_id", "page_group", "university_id", "lead_ref"]);
    for (const event of events) for (const key of Object.keys(event)) expect(allowed.has(key), key).toBe(true);
    expect(events.every((e) => (e.session_id as string | undefined)?.match(/^[a-f0-9]{24}$/))).toBe(true);
    const wire = JSON.stringify(events);
    for (const secret of ["wa.me", "country", "whatsapp"]) expect(wire.toLowerCase()).not.toContain(secret);
  });

  test("the install prompt appears for a returning visitor only, counts an install, and the manifest and icons are served", async ({ page, context, request }) => {
    const server = await install(context);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // First visit: nothing to offer, even if the browser says it could install.
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      event.prompt = async () => undefined;
      event.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(event);
    });
    await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);

    // Two more browsing sessions make a returning visitor.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const open = indexedDB.open("scollarly");
          open.onsuccess = () => {
            const tx = open.result.transaction("meta", "readwrite");
            tx.objectStore("meta").put(3, "visits");
            tx.oncomplete = () => resolve();
          };
        }),
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      event.prompt = async () => undefined;
      event.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(event);
    });
    await expect(page.getByRole("button", { name: "Install app" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect.poll(() => server.events.flat().some((e) => e.type === "install")).toBe(true);

    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ name: "Scollarly", display: "standalone", start_url: "/" });
    for (const icon of manifest.icons as { src: string }[]) expect((await request.get(icon.src)).status()).toBe(200);
    expect((manifest.icons as { sizes: string }[]).map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  test("events wait and travel together: a few page views are not sent one by one", async ({ page, context }) => {
    const server = await install(context);
    for (const path of ["/", "/faq", "/about"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    await page.waitForTimeout(500);
    expect(server.events.length).toBe(0); // fewer than 5 events and none old enough
  });
});
