import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Stage 3 exit criteria on a production build prerendered from `tests/fixtures/content-snapshot.json` (the build-time
 * content seam, `src/modules/content/fixture.ts`): every public page, with JavaScript off, accessible, laid out at 375 px,
 * fees gated, video and tour facades, no admin code in the page.
 */

const PAGES = [
  "/",
  "/universities",
  "/universities/alpha-university",
  "/universities/beta-university",
  "/fees",
  "/campus-tours",
  "/process",
  "/visa",
  "/faq",
  "/about",
  "/blog",
  "/blog/how-to-apply",
  "/contact",
  "/privacy",
  "/terms",
  "/offline",
];

const bodyText = (page: Page) => page.locator("main").innerText();
/** All the text in the HTML, including answers inside a closed question (FR-1: the content is there without a script). */
const htmlText = async (page: Page) => (await page.locator("main").textContent()) ?? "";

for (const path of PAGES) {
  test(`${path}: one h1 and one main, axe finds no WCAG 2.1 A or AA violation, no sideways scroll at 375 px`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(path);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page).toHaveTitle(/\S/);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test.describe("FR-1: with JavaScript off, every public page shows its main content", () => {
  test.use({ javaScriptEnabled: false });

  const expectations: Record<string, string[]> = {
    "/": ["Our help is free for students.", "Alpha University", "Start your application", "Students helped", "They answered me on WhatsApp the same day."],
    "/universities": ["Alpha University", "Beta University", "Gamma University", "Fees to be confirmed"],
    "/universities/alpha-university": ["Alpha University is a test university", "B.Tech Computer Science", "USD 3,000 – 6,000", "Official prospectus"],
    "/fees": ["Alpha University", "USD 3,000 – 6,000", "INR 150,000 – 250,000", "Contact us"],
    "/campus-tours": ["Official campus tour", "Available on request."],
    "/process": ["Share your results", "Pick at least three programmes."],
    "/visa": ["Collect your documents"],
    "/faq": ["Is Scollarly free for students?", "Yes. Students pay Scollarly nothing."],
    "/about": ["We want every student to study where they can thrive.", "Test Teammate"],
    "/blog": ["How to apply", "Visa checklist"],
    "/blog/how-to-apply": ["Start with your results."],
    "/contact": ["+14155550100", "hello@scollarly.example"],
    "/privacy": ["Our full privacy notice is being finalised."],
    "/terms": ["Our full terms are being finalised."],
  };

  for (const [path, texts] of Object.entries(expectations)) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      const text = await htmlText(page);
      for (const expected of texts) expect(text, expected).toContain(expected);
    });
  }
});

test.describe("FR-2: fees", () => {
  test("a confirmed fee shows its range, currency and last-updated date, with the disclaimer", async ({ page }) => {
    await page.goto("/universities/alpha-university");
    const text = await bodyText(page);
    expect(text).toContain("USD 3,000 – 6,000");
    expect(text).toContain("tuition per year");
    expect(text).toContain("Last updated 2026-06-12");
    expect(text).toContain("Fees are set by the university and can change.");
    expect(text).not.toMatch(/\b(USD|INR) 0\b/);
  });

  test("an unconfirmed fee shows 'Fees to be confirmed' and a WhatsApp call to action, never 0 or a blank", async ({ page }) => {
    await page.goto("/universities/beta-university");
    const text = await bodyText(page);
    expect(text).toContain("Fees to be confirmed");
    expect(text).not.toMatch(/\b(USD|INR) 0\b/);
    const whatsapp = page.getByRole("link", { name: "Ask about this university on WhatsApp" }).first();
    await expect(whatsapp).toBeVisible();
    // The address comes from the number in site_setting (here the fixture's), through the one helper (FR-4).
    await expect(whatsapp).toHaveAttribute("href", "https://wa.me/14155550100");
  });

  test("the fees page lists a range per currency and 'Contact us' for the university without one", async ({ page }) => {
    await page.goto("/fees");
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "Beta University" })).toContainText("Contact us");
    await expect(rows.filter({ hasText: "Gamma University" })).toContainText("INR 150,000 – 250,000");
    expect(await bodyText(page)).not.toContain("USD 153");
  });

  test("the currency chips narrow the table without a request", async ({ page }) => {
    await page.goto("/fees");
    await page.getByRole("button", { name: "INR" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "All" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
  });
});

test.describe("FR-3: nothing loads before a tap", () => {
  test("a video makes no request to YouTube and has no iframe until it is tapped, then uses youtube-nocookie", async ({ page }) => {
    const outside: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname !== "localhost") outside.push(url.hostname);
    });
    await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>video</body></html>" }));

    await page.goto("/universities/alpha-university");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(outside).toEqual([]);

    await page.getByRole("button", { name: /Play video/ }).click();
    const frame = page.locator("iframe");
    await expect(frame).toHaveCount(1);
    expect(await frame.getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/5ddvpNEqpec\?/);
    expect(outside.every((host) => host === "www.youtube-nocookie.com")).toBe(true);
  });

  test("a 360 tour shows a data notice first and loads only after the second tap", async ({ page }) => {
    await page.route("https://tour.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>tour</body></html>" }));
    await page.goto("/universities/alpha-university");
    await page.getByRole("button", { name: /View 360° tour/ }).click();
    await expect(page.locator("figure [role=alert]")).toContainText("may use a lot of mobile data");
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.getByRole("button", { name: "Open the tour" }).click();
    await expect(page.locator("iframe")).toHaveCount(1);
    expect(await page.locator("iframe").getAttribute("src")).toBe("https://tour.example/alpha/");
  });

  test("offline, a tap says it needs a connection and loads nothing", async ({ page, context }) => {
    await page.goto("/universities/alpha-university");
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.getByRole("button", { name: /Play video/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Needs a connection" })).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("the campus tours page also keeps every embed behind a tap", async ({ page }) => {
    await page.goto("/campus-tours");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Play video/ })).toBeVisible();
  });
});

test.describe("A2: the universities list", () => {
  test("the search box narrows the list and a no-match message appears, all in the browser", async ({ page }) => {
    await page.goto("/universities");
    await expect(page.locator("ul.cards > li")).toHaveCount(3);
    await page.getByLabel("Search").fill("beta");
    await expect(page.locator("ul.cards > li")).toHaveCount(1);
    await page.getByLabel("Search").fill("zzz");
    await expect(page.getByText("No university matches.")).toBeVisible();
  });

  test("a city chip filters, and tapping it again clears it", async ({ page }) => {
    await page.goto("/universities");
    await page.getByRole("group", { name: "Filter by city" }).getByRole("button", { name: "Mohali" }).click();
    await expect(page.locator("ul.cards > li")).toHaveCount(1);
    await page.getByRole("group", { name: "Filter by city" }).getByRole("button", { name: "Mohali" }).click();
    await expect(page.locator("ul.cards > li")).toHaveCount(3);
  });
});

test.describe("S12.1: the owner's page photos render where the snapshot has them", () => {
  const cases: [string, string, string][] = [
    ["/", ".hero-photo", "African students talking together on an Indian university campus"],
    ["/about", ".page-photo", "A student studying with a laptop and notes"],
    ["/campus-tours", ".page-photo", "A university campus building in India"],
    ["/universities", ".page-photo", "A world map illustrating Scollarly's network of partner universities"],
  ];

  for (const [path, selector, alt] of cases) {
    test(`${path}: the photo has real alt text and a well-formed media src`, async ({ page }) => {
      await page.goto(path);
      const img = page.locator(selector);
      await expect(img).toHaveCount(1);
      await expect(img).toHaveAttribute("alt", alt);
      // This build's fixture has no real object behind the hash (S3.5: a build-time snapshot, no storage attached),
      // so this checks the markup is well-formed (architecture 6.5's own `<img>` shape), not that the byte decodes.
      const src = await img.getAttribute("src");
      expect(src).toMatch(/^\/media\/[a-f0-9]{64}\.webp$/);
      expect(await img.getAttribute("width")).toMatch(/^\d+$/);
      expect(await img.getAttribute("height")).toMatch(/^\d+$/);
    });
  }
});

test.describe("A7: a post cannot inject markup", () => {
  test("script text is shown as text, an unsafe link is not a link, and there is no image", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/blog/how-to-apply");
    const article = page.locator("article");
    await expect(article).toContainText("<script>window.__xss = 1</script>");
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(article.locator("a[href^='javascript']")).toHaveCount(0);
    await expect(article.locator("img")).toHaveCount(0);
    await expect(article.getByRole("link", { name: "good link" })).toHaveAttribute("href", "https://example.com/guide");
    expect(errors).toEqual([]);
  });
});

test.describe("S3.4 and S3.5", () => {
  test("home shows the confirmed figure and testimonial the snapshot holds, and the public pages ship no admin code", async ({ page }) => {
    const scripts: string[] = [];
    page.on("response", async (response) => {
      if (response.url().endsWith(".js")) scripts.push(await response.text().catch(() => ""));
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("120+")).toBeVisible();
    await expect(page.getByText("Test Student")).toBeVisible();
    const all = scripts.join("\n");
    // Fingerprints of the admin UI libraries (see scripts/check-public-bundle.mjs).
    expect(all).not.toContain("compoundVariants");
    expect(all).not.toContain("recharts-");
  });

  test("the first load of the home page stays under 200 KB without lazy images", async ({ page }) => {
    let bytes = 0;
    // What went over the wire (compressed), not the decoded size.
    page.on("requestfinished", async (request) => {
      const sizes = await request.sizes().catch(() => null);
      if (sizes) bytes += sizes.responseBodySize + sizes.responseHeadersSize;
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(bytes).toBeLessThan(200 * 1024);
  });

  test("reduced motion is honoured: nothing animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const animated = await page.evaluate(() => document.getAnimations().length);
    expect(animated).toBe(0);
  });

  test("a university that does not exist is a 404, and a page is not stored as a 404", async ({ request }) => {
    expect((await request.get("/universities/no-such-university")).status()).toBe(404);
    expect((await request.get("/blog/no-such-post")).status()).toBe(404);
  });
});
