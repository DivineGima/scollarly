import { expect, test, type Page } from "@playwright/test";

/**
 * S0.8: Serwist offline page, tested in the browser's offline mode against a production build.
 * Also proves the service worker never caches private areas (architecture 11.1).
 */

async function waitForServiceWorkerControl(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    return Boolean(reg?.active);
  });
  // The worker installs during the first load and then claims the page a moment later (clientsClaim).
  // A navigation made before that claim is not seen by the worker, so wait for control first, then reload
  // once so that this navigation is handled (and cached) by the worker.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  // Stale-while-revalidate stores the page after responding. Once it is in the cache the worker has
  // finished its first controlled navigation, which is the real-world state of a returning visitor.
  await expect.poll(() => cachedUrls(page), { timeout: 15_000 }).toContain("/");
}

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
}

test.describe("service worker and offline page (S0.8)", () => {
  test("registers a service worker and precaches the offline page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Study in India from Africa" })).toBeVisible();
    await waitForServiceWorkerControl(page);
    expect(await cachedUrls(page)).toContain("/offline");
  });

  test("serves a page that was visited before when the phone goes offline", async ({ page, context }) => {
    await page.goto("/");
    await waitForServiceWorkerControl(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Study in India from Africa" })).toBeVisible();
    await expect(page.getByText("Our help is free for students.")).toBeVisible();
  });

  test("shows the offline page for a page that was never visited", async ({ page, context }) => {
    await page.goto("/");
    await waitForServiceWorkerControl(page);
    await context.setOffline(true);
    // "commit": a worker-served navigation made offline can otherwise return before the page is shown.
    await page.goto("/never-visited-page", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
  });

  test("opens the offline page directly while offline", async ({ page, context }) => {
    await page.goto("/");
    await waitForServiceWorkerControl(page);
    await context.setOffline(true);
    await page.goto("/offline", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
  });
});

test.describe("private areas are never cached (architecture 11.1)", () => {
  test("API, admin, student and auth responses are not stored by the service worker", async ({ page }) => {
    await page.goto("/");
    await waitForServiceWorkerControl(page);

    // Requests the worker sees: all four are same-origin and match its never-cache list.
    for (const path of ["/api/v1/health", "/admin/phase0", "/me/phase0", "/sign-in"]) {
      await page.evaluate((p) => fetch(p).catch(() => undefined), path);
    }
    for (const path of ["/admin/phase0", "/me/phase0", "/sign-in"]) {
      await page.goto(path).catch(() => undefined);
      await page.goto("/");
    }

    const stored = await cachedUrls(page);
    const privatePattern = /^\/(admin|me|api|sign-in|sign-up|verify-email|forgot-password|reset-password|accept-invite|two-factor)(\/|$)/;
    expect(stored.filter((u) => privatePattern.test(u))).toEqual([]);
  });

  test("the offline page does not appear as the content of a private URL while online", async ({ page }) => {
    await page.goto("/");
    await waitForServiceWorkerControl(page);
    const res = await page.goto("/api/v1/health");
    expect(res?.status()).toBe(200);
    expect(await page.textContent("body")).toContain('"status":"ok"');
  });
});
