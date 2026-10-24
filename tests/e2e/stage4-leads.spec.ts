import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Stage 4 exit criteria in a real browser (production build, content from the test snapshot): lead intake offline and
 * online, send-first with the 4 second rule, exactly one lead under retries, double submit and two tabs, the queue, events
 * and install. The Worker is not there under `next start`, so `/api/v1/leads` and `/api/v1/events` are answered by a small
 * in-memory server that behaves like the real one (idempotency by key, 409 on a changed payload), and Turnstile and wa.me are
 * stubbed. The real endpoint's rules are proven in tests/integration/stage4-leads.test.ts and tests/unit/lead-service.test.ts.
 */

test.use({ serviceWorkers: "block" });

interface StoredLead {
  key: string;
  body: Record<string, unknown>;
  ref: string;
  hash: string;
}

interface FakeServer {
  leads: StoredLead[];
  posts: { key: string; token: unknown }[];
  events: Record<string, unknown>[][];
  /** Status to answer with for the next N lead POSTs before behaving normally. */
  failNext: number;
  failStatus: number;
  delayMs: number;
}

const TURNSTILE_STUB = `window.turnstile = { render: function (el, o) { setTimeout(function () { o.callback("test-token-" + Math.random().toString(36).slice(2)); }, 20); return "w" + Math.random(); }, remove: function () {} };`;

async function install(context: BrowserContext): Promise<FakeServer> {
  const server: FakeServer = { leads: [], posts: [], events: [], failNext: 0, failStatus: 503, delayMs: 0 };

  await context.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: TURNSTILE_STUB }));
  await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>whatsapp</body></html>" }));

  await context.route("**/api/v1/leads", async (route) => {
    const request = route.request();
    const key = request.headers()["idempotency-key"] ?? "";
    const { turnstile_token: token, ...body } = request.postDataJSON() as Record<string, unknown>;
    server.posts.push({ key, token });
    if (server.delayMs) await new Promise((r) => setTimeout(r, server.delayMs));
    if (server.failNext > 0) {
      server.failNext -= 1;
      return route.fulfill({ status: server.failStatus, contentType: "application/json", body: JSON.stringify({ error: { code: "TEMPORARILY_UNAVAILABLE", message: "x" }, request_id: "r" }) });
    }
    const hash = JSON.stringify(body, Object.keys(body).sort());
    const existing = server.leads.find((l) => l.key === key);
    if (existing) {
      return existing.hash === hash
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "replayed", ref: existing.ref }) })
        : route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "IDEMPOTENCY_KEY_REUSED", message: "x" }, request_id: "r" }) });
    }
    const ref = String(body.client_ref);
    server.leads.push({ key, body, ref, hash });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ status: "created", ref }) });
  });

  await context.route("**/api/v1/events", async (route) => {
    server.events.push((route.request().postDataJSON() as { events: Record<string, unknown>[] }).events);
    return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) });
  });
  return server;
}

const queued = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("scollarly");
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("leadQueue")) return resolve(0);
          const request = db.transaction("leadQueue").objectStore("leadQueue").count();
          request.onsuccess = () => resolve(request.result);
        };
      }),
  );

async function fillQuick(page: Page, name = "Ama Test", number = "612345678") {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your full name").fill(name);
  await dialog.getByLabel("Your country").selectOption("CM");
  await dialog.getByLabel("Your WhatsApp number").fill(number);
  await dialog.getByRole("checkbox").check();
  return dialog;
}

const openQuick = async (page: Page) => {
  await page.goto("/universities/alpha-university");
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Ask about this university on WhatsApp" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test.describe("the quick WhatsApp form (A5b, ADR-030)", () => {
  test("online: Continue saves the lead on the server and then opens WhatsApp with the reference", async ({ page, context }) => {
    const server = await install(context);
    await openQuick(page);
    const dialog = await fillQuick(page);
    const started = Date.now();
    const popup = context.waitForEvent("page");
    await dialog.getByRole("button", { name: "Continue" }).click();
    const wa = await popup;
    expect(Date.now() - started).toBeLessThan(4500);

    expect(server.leads).toHaveLength(1);
    const lead = server.leads[0]!;
    expect(lead.body).toMatchObject({ intake_kind: "quick", name: "Ama Test", country_code: "CM", whatsapp: "612345678", locale: "en", consent: { notice_version: "draft-1" } });
    expect((lead.body.source as Record<string, unknown>).university_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(lead.body).not.toHaveProperty("turnstile_token");
    expect(server.posts[0]?.token).toMatch(/^test-token-/);

    // The chat opens on the configured number (from the settings, not the code), with the reference in the message.
    expect(wa.url()).toContain("https://wa.me/14155550100?text=");
    expect(decodeURIComponent(wa.url())).toContain(lead.ref);
    await expect(dialog.getByTestId("lead-ref")).toHaveText(lead.ref);
    await expect(dialog.getByText("Sent", { exact: true })).toBeVisible();
    expect(await queued(page)).toBe(0);
  });

  test("a quick form on a page with no university asks which one (the rule needs a university or a programme)", async ({ page, context }) => {
    const server = await install(context);
    await page.goto("/fees");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Chat on WhatsApp" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Your full name").fill("Ama Test");
    await dialog.getByLabel("Your country").selectOption("CM");
    await dialog.getByLabel("Your WhatsApp number").fill("612345678");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("Choose the university you are interested in.")).toBeVisible();
    expect(server.posts).toHaveLength(0);
    await dialog.getByLabel("University you are interested in").selectOption({ label: "Beta University" });
    const popup = context.waitForEvent("page");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await popup;
    expect(server.leads).toHaveLength(1);
  });

  test("shows each missing field inline and sends nothing until the form is valid", async ({ page, context }) => {
    const server = await install(context);
    await openQuick(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("This field is required.").first()).toBeVisible();
    await expect(dialog.getByText("Please tick this box to continue.")).toBeVisible();
    await dialog.getByLabel("Your country").selectOption("CM");
    await dialog.getByLabel("Your full name").fill("Ama");
    await dialog.getByLabel("Your WhatsApp number").fill("12");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("Check this number and its country code.")).toBeVisible();
    expect(server.posts).toHaveLength(0);
  });

  test("offline: nothing is sent, WhatsApp opens at once, the lead is Saved, and it is sent exactly once when the phone is back online", async ({ page, context }) => {
    const server = await install(context);
    await openQuick(page);
    const dialog = await fillQuick(page);
    await context.setOffline(true);
    const popup = context.waitForEvent("page");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await popup;
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    expect(server.posts).toHaveLength(0);
    expect(await queued(page)).toBe(1);
    await expect(page.getByText("Waiting to send from this phone: 1")).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.leads.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => queued(page)).toBe(0);
    expect(new Set(server.posts.map((p) => p.key)).size).toBe(1);
  });

  test("slow (over 4 seconds): WhatsApp opens anyway, the lead stays queued, and the late answer leaves exactly one lead", async ({ page, context }) => {
    const server = await install(context);
    server.delayMs = 6000;
    await openQuick(page);
    const dialog = await fillQuick(page);
    const started = Date.now();
    const popup = context.waitForEvent("page");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await popup;
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThan(3500);
    expect(waited).toBeLessThan(5800);
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    expect(await queued(page)).toBe(1);

    await expect.poll(() => queued(page), { timeout: 10_000 }).toBe(0);
    expect(server.leads).toHaveLength(1);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(500);
    expect(server.leads).toHaveLength(1);
  });

  test("a server error keeps the lead and a later sync, with the same key, gives exactly one lead even with repeated 'online' events", async ({ page, context }) => {
    const server = await install(context);
    server.failNext = 1;
    await openQuick(page);
    const dialog = await fillQuick(page);
    const popup = context.waitForEvent("page");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await popup;
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    expect(server.leads).toHaveLength(0);

    // Forced retries: hammer the triggers. The backoff (5 s after the first failure) decides when it is tried again.
    for (let i = 0; i < 5; i++) await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.leads.length, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => queued(page)).toBe(0);
    expect(new Set(server.posts.map((p) => p.key)).size).toBe(1);
    expect(server.leads).toHaveLength(1);
  });

  test("a refusal from the server shows the fields and queues nothing", async ({ page, context }) => {
    await install(context);
    await context.route("**/api/v1/leads", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION", message: "x", fields: { whatsapp: "PHONE_INVALID" } }, request_id: "r" }) }),
    );
    await openQuick(page);
    const dialog = await fillQuick(page);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("Check this number and its country code.")).toBeVisible();
    expect(await queued(page)).toBe(0);
  });

  test("a number that has reached its daily limit is told so and offered the chat, with no lead stored", async ({ page, context }) => {
    await install(context);
    await context.route("**/api/v1/leads", (route) =>
      route.fulfill({ status: 429, headers: { "Retry-After": "3600" }, contentType: "application/json", body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "x", fields: { reason: "number_limit" } }, request_id: "r" }) }),
    );
    await openQuick(page);
    const dialog = await fillQuick(page);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("This number has already sent several applications today.")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", "https://wa.me/14155550100");
    expect(await queued(page)).toBe(0);
  });
});

async function chooseProgrammes(page: Page, names: string[]) {
  for (const name of names) {
    await page.getByLabel("Search programmes or universities").fill(name);
    await page.getByRole("button", { name: new RegExp(`^Add ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  }
}

test.describe("the full application (A5)", () => {
  async function fillApply(page: Page) {
    await page.getByLabel("Your full name").fill("Kofi Full");
    await page.getByLabel("Your country").selectOption("CM");
    await page.getByLabel("Your WhatsApp number").fill("612345678");
    await page.getByLabel("O-level and A-level").check();
    await chooseProgrammes(page, ["B.Tech Computer Science", "MBA", "BBA"]);
    await page.getByRole("checkbox").check();
  }

  test("is refused with fewer than 3 programmes, with the field highlighted and nothing sent", async ({ page, context }) => {
    const server = await install(context);
    await page.goto("/apply");
    await page.getByLabel("Your full name").fill("Kofi");
    await page.getByLabel("Your country").selectOption("CM");
    await page.getByLabel("Your WhatsApp number").fill("612345678");
    await page.getByLabel("O-level and A-level").check();
    await chooseProgrammes(page, ["MBA", "BBA"]);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose at least 3 different programmes.")).toBeVisible();
    expect(server.posts).toHaveLength(0);
  });

  test("online: saves the lead with the programmes in the chosen order and then opens WhatsApp with the reference", async ({ page, context }) => {
    const server = await install(context);
    await page.goto("/apply");
    await fillApply(page);
    await page.getByRole("button", { name: "Move down" }).first().click();
    const popup = context.waitForEvent("page");
    await page.getByRole("button", { name: "Continue" }).click();
    const wa = await popup;
    expect(server.leads).toHaveLength(1);
    expect(server.leads[0]?.body).toMatchObject({ intake_kind: "full", qualification_type: "olevel_alevel", country_code: "CM" });
    expect((server.leads[0]?.body.programme_ids as string[]).length).toBe(3);
    expect(decodeURIComponent(wa.url())).toContain(server.leads[0]!.ref);
    await expect(page.getByText("We have your application")).toBeVisible();
  });

  test("a double tap on Continue stores one lead", async ({ page, context }) => {
    const server = await install(context);
    server.delayMs = 800;
    await page.goto("/apply");
    await fillApply(page);
    const button = page.getByRole("button", { name: /Continue|Sending/ });
    await button.dblclick();
    await expect(page.getByText("We have your application")).toBeVisible();
    expect(server.posts).toHaveLength(1);
    expect(server.leads).toHaveLength(1);
  });

  test("created offline, then online with two tabs open, gives exactly one lead", async ({ page, context }) => {
    const server = await install(context);
    // The second tab is opened while still online (the service worker is blocked here, so an offline page load would fail).
    const second = await context.newPage();
    await second.goto("/apply");
    await second.waitForLoadState("networkidle");
    await page.goto("/apply");
    await page.waitForLoadState("networkidle");
    await fillApply(page);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Saved on your phone" })).toBeVisible();
    expect(await queued(second)).toBe(1);

    await context.setOffline(false);
    await Promise.all([page, second].map((p) => p.evaluate(() => window.dispatchEvent(new Event("online")))));
    await expect.poll(() => server.leads.length, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => queued(page)).toBe(0);
    expect(new Set(server.posts.map((p) => p.key)).size).toBe(1);
    expect(server.leads).toHaveLength(1);
  });

  test("'Remove from this phone' asks first, then deletes the unsent application", async ({ page, context }) => {
    await install(context);
    await page.goto("/apply");
    await fillApply(page);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Saved on your phone" })).toBeVisible();
    expect(await queued(page)).toBe(1);

    await page.getByRole("button", { name: /Remove from this phone/ }).first().click();
    await expect(page.getByText("Remove this saved application from your phone?")).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).click();
    expect(await queued(page)).toBe(1);
    await page.getByRole("button", { name: /Remove from this phone/ }).first().click();
    await page.getByRole("alert").getByRole("button", { name: "Remove from this phone" }).click();
    await expect.poll(() => queued(page)).toBe(0);
  });
});

test.describe("analytics events (S4.5) and install (S4.1)", () => {
  test("a tap on WhatsApp is sent with its reference and nothing that identifies the person; page views are counts only", async ({ page, context }) => {
    const server = await install(context);
    await openQuick(page);
    const dialog = await fillQuick(page);
    const popup = context.waitForEvent("page");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await popup;
    await expect.poll(() => server.events.flat().some((e) => e.type === "wa_tap")).toBe(true);

    const events = server.events.flat();
    const tap = events.find((e) => e.type === "wa_tap")!;
    expect(tap.lead_ref).toBe(server.leads[0]!.ref);
    expect(Object.keys(tap).sort()).toEqual(["lead_ref", "occurred_at", "page_group", "session_id", "type", "university_id"].sort());
    const wire = JSON.stringify(events);
    for (const secret of ["Ama Test", "612345678", "wa.me", "country"]) expect(wire).not.toContain(secret);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["page_view", "form_start", "form_submit", "wa_tap"]));
    expect(events.every((e) => (e.session_id as string | undefined)?.match(/^[a-f0-9]{24}$/))).toBe(true);
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
