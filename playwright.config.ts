import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// S0.8: the service worker only exists in a production build, so the tests run against `next start`.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Pixel 5"] },
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health`,
    // The site is built from a content snapshot file (src/modules/content/fixture.ts), so every page has content and no database is needed.
    // The site key is Cloudflare's documented always-pass test key; the tests stub the widget script anyway.
    env: { CONTENT_FIXTURE_FILE: "tests/fixtures/content-snapshot.json", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
