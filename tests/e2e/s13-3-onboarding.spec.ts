import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";

/**
 * S13.3 (architecture 21.6): the questionnaire in a real browser at phone width. The server side (one lead, one profile, replays, a second
 * device) is proven against a real database in tests/integration/s13-3-onboarding.test.ts; here the two endpoints are stubbed and we check what
 * a person sees and what the screens send.
 */

// Once the service worker controls a reloaded page, Playwright's stubs no longer see its requests and they reach the real test server (which
// has no signed-in endpoints). Blocking the worker keeps the stubs in charge; the worker's own rules are covered by tests/e2e/offline.spec.ts.
test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

interface Stub {
  posts: Request[];
  /** While true the POST fails like a lost connection. */
  blocked: boolean;
  /** The status the next POST answers with. */
  answer: { status: number; body: unknown };
}

async function stub(page: Page, state: { onboarded?: boolean; relationship?: "student" | "parent" | null; ref?: string | null } = {}): Promise<Stub> {
  const handle: Stub = { posts: [], blocked: false, answer: { status: 201, body: { status: "created", ref: "SC-ABCDE-FGHJK" } } };
  await page.route("**/api/v1/me/onboarding-state", (route) =>
    json(route, { userId: "user-1", onboarded: state.onboarded ?? false, relationship: state.relationship ?? null, ref: state.ref ?? null }),
  );
  await page.route("**/api/v1/me/onboarding", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    if (handle.blocked) return route.abort("failed");
    handle.posts.push(route.request());
    return json(route, handle.answer.body, handle.answer.status);
  });
  return handle;
}

async function fillBasics(page: Page) {
  await page.getByLabel("Your full name").fill("Ada Eze");
  await page.getByLabel("Your country").selectOption("NG");
  await page.getByLabel("Your WhatsApp number").fill("+2348031234567");
}

async function fillResults(page: Page) {
  await page.getByRole("radio", { name: "O Level / A Level (GCE)" }).check();
  await page.getByRole("button", { name: "Add a subject" }).click();
  await page.getByLabel("Subject").fill("Mathematics");
  await page.getByLabel("Grade", { exact: true }).fill("A");
}

async function fillPlan(page: Page) {
  await page.getByRole("radio", { name: /Bachelor's degree/ }).check();
  await page.getByRole("checkbox", { name: "Computer Science and IT" }).check();
  await page.getByLabel("When would you like to start?").selectOption({ index: 1 });
}

async function reachConsent(page: Page) {
  await fillBasics(page);
  await page.getByRole("button", { name: "Next" }).click();
  await fillResults(page);
  await page.getByRole("button", { name: "Next" }).click();
  await fillPlan(page);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Almost done" })).toBeVisible();
}

const consent = (page: Page) => page.getByRole("checkbox", { name: /I agree that Scollarly/ });

test.describe("a student", () => {
  test("goes through the screens, ticks the consent, and finishes with a reference", async ({ page }) => {
    const server = await stub(page);
    await page.goto("/me/onboarding?as=student");
    await expect(page.getByText("Step 1 of 4")).toBeVisible();
    await expect(page.getByRole("heading", { name: "About you" })).toBeFocused();
    await axe(page);

    await fillBasics(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Step 2 of 4")).toBeVisible();
    await axe(page);
    await fillResults(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Step 3 of 4")).toBeVisible();
    await axe(page);
    await fillPlan(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Step 4 of 4")).toBeVisible();
    await axe(page);

    await consent(page).check();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Thank you, you are all set" })).toBeVisible();
    await expect(page.getByText("Your reference: SC-ABCDE-FGHJK")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to my page" })).toHaveAttribute("href", "/me");

    expect(server.posts).toHaveLength(1);
    const request = server.posts[0] as Request;
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    const body = request.postDataJSON();
    expect(body).toMatchObject({ relationship: "student", applicant_name: "Ada Eze", applicant_country: "NG", contact_name: "Ada Eze", contact_country: "NG", contact_whatsapp: "+2348031234567", qualification_type: "olevel_alevel", level: "undergraduate", course_fields: ["computer_science_it"], results: [{ subject: "Mathematics", grade: "A" }], consent: { notice_version: expect.any(String) } });
    expect(body.turnstile_token).toBeUndefined();
  });

  test("is told what is missing, on the screen they are on, and the answers show the problem", async ({ page }) => {
    await stub(page);
    await page.goto("/me/onboarding?as=student");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("alert").first()).toHaveText("Please fix the highlighted answers to continue.");
    await expect(page.getByText("This answer is needed.").first()).toBeVisible();
    await expect(page.getByText("Step 1 of 4")).toBeVisible();
    await axe(page);
    await page.getByLabel("Your full name").fill("Ada Eze");
    await page.getByLabel("Your country").selectOption("NG");
    await page.getByLabel("Your WhatsApp number").fill("12345");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("This number does not look right for that country.")).toBeVisible();
  });

  test("cannot finish without the consent tick", async ({ page }) => {
    const server = await stub(page);
    await page.goto("/me/onboarding?as=student");
    await reachConsent(page);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText("Please tick the box to continue.")).toBeVisible();
    expect(server.posts).toHaveLength(0);
  });

  test("starts the study plan with the course chosen on the landing page", async ({ page }) => {
    await stub(page);
    await page.goto("/me/onboarding?as=student&course=law");
    await fillBasics(page);
    await page.getByRole("button", { name: "Next" }).click();
    await fillResults(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("checkbox", { name: "Law" })).toBeChecked();
  });

  test("limits the courses to five", async ({ page }) => {
    await stub(page);
    await page.goto("/me/onboarding?as=student");
    await fillBasics(page);
    await page.getByRole("button", { name: "Next" }).click();
    await fillResults(page);
    await page.getByRole("button", { name: "Next" }).click();
    const boxes = page.getByRole("group", { name: /Which courses interest you/ }).getByRole("checkbox");
    for (let i = 0; i < 5; i += 1) await boxes.nth(i).check();
    await expect(boxes.nth(5)).toBeDisabled();
  });

  test("leaves halfway and comes back to the same screen with the same answers", async ({ page }) => {
    await stub(page);
    await page.goto("/me/onboarding?as=student");
    await fillBasics(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Step 2 of 4")).toBeVisible();
    // Reload only once the phone's database holds the draft on the second screen (it is written a moment after the change).
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open("scollarly");
              open.onerror = () => resolve("");
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains("onboardingDraft")) return resolve("");
                const all = db.transaction("onboardingDraft").objectStore("onboardingDraft").getAll();
                all.onsuccess = () => resolve((all.result[0] as { step?: string } | undefined)?.step ?? "");
                all.onerror = () => resolve("");
              };
            }),
        ),
      )
      .toBe("results");
    // A reloaded page hydrates and reads the phone's database again, which is slow on a busy CI machine.
    await page.reload();
    await expect(page.getByText("Step 2 of 4")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Your full name")).toHaveValue("Ada Eze");
    await expect(page.getByLabel("Your WhatsApp number")).toHaveValue("+2348031234567");
  });
});

test.describe("a parent", () => {
  test("is asked about the child first, then gives their own name and number, and the lead carries both", async ({ page }) => {
    const server = await stub(page);
    await page.goto("/me/onboarding?as=parent");
    await expect(page.getByText("Step 1 of 5")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who is applying?" })).toBeVisible();
    await page.getByLabel("The student's full name").fill("Chidi Eze");
    await page.getByLabel("The student's country").selectOption("NG");
    await page.getByRole("button", { name: "Next" }).click();
    await fillResults(page);
    await page.getByRole("button", { name: "Next" }).click();
    await fillPlan(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Your contact details" })).toBeVisible();
    // The number's country starts as the child's, and the parent changes it if they live elsewhere.
    await expect(page.getByLabel("Your country")).toHaveValue("NG");
    await axe(page);
    await page.getByLabel("Your full name").fill("Ngozi Eze");
    await page.getByLabel("Your country").selectOption("CM");
    await page.getByLabel("Your WhatsApp number").fill("6 71 23 45 67");
    await page.getByRole("button", { name: "Next" }).click();
    await consent(page).check();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Thank you, you are all set" })).toBeVisible();
    expect(server.posts[0]?.postDataJSON()).toMatchObject({ relationship: "parent", applicant_name: "Chidi Eze", applicant_country: "NG", contact_name: "Ngozi Eze", contact_country: "CM", contact_whatsapp: "6 71 23 45 67" });
  });
});

/** What the page shows and what the phone's queue holds, so a failure in CI says what happened instead of only what was missing. */
async function describePage(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const text = (document.querySelector("main")?.textContent ?? "").slice(0, 200);
        const open = indexedDB.open("scollarly");
        open.onerror = () => resolve(`${text} | no database`);
        open.onsuccess = () => {
          const all = open.result.transaction("leadQueue").objectStore("leadQueue").getAll();
          all.onsuccess = () => resolve(`${text} | queue: ${JSON.stringify((all.result as { kind?: string; status?: string; lastError?: string | null; attempts?: number }[]).map((i) => ({ kind: i.kind, status: i.status, lastError: i.lastError, attempts: i.attempts })))} | online: ${navigator.onLine}`);
          all.onerror = () => resolve(`${text} | queue unreadable`);
        };
      }),
  );
}

async function setConnection(context: BrowserContext, server: Stub, online: boolean) {
  server.blocked = !online;
  await context.setOffline(!online);
}

test.describe("without a connection, and without a session", () => {
  test("offline: saves on the phone, then sends exactly once when the connection returns", async ({ page, context }) => {
    const server = await stub(page);
    await page.goto("/me/onboarding?as=student");
    await reachConsent(page);
    await consent(page).check();

    await setConnection(context, server, false);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
    await expect(page.getByText(/You are offline/)).toBeVisible();
    expect(server.posts).toHaveLength(0);
    await axe(page);

    await setConnection(context, server, true);
    await expect(page.getByRole("heading", { name: "Thank you, you are all set" })).toBeVisible({ timeout: 20_000 });
    expect(server.posts).toHaveLength(1);
  });

  test("a finished questionnaire that is still waiting is shown as waiting after a reload, not asked again", async ({ page, context }) => {
    const server = await stub(page);
    await page.goto("/me/onboarding?as=student");
    await reachConsent(page);
    await consent(page).check();
    await setConnection(context, server, false);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
    // The phone is back online but the server is still unreachable, so the answers must still be waiting after a reload.
    await context.setOffline(false);
    // A navigation straight after the connection returns can briefly fail on a busy machine, so try the reload until the page answers.
    await expect(async () => {
      await page.reload();
      try {
        await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible({ timeout: 8_000 });
      } catch (error) {
        throw new Error(`${(error as Error).message}
PAGE: ${await describePage(page)}`);
      }
    }).toPass({ timeout: 40_000 });
  });

  test("an ended session keeps the answers and asks the person to sign in", async ({ page }) => {
    const server = await stub(page);
    server.answer = { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Sign in required." }, request_id: "r" } };
    await page.goto("/me/onboarding?as=student");
    await reachConsent(page);
    await consent(page).check();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
    await expect(page.getByText("Your session ended. Sign in to send your answers.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  test("answers it could not accept are sent back for review with a fresh start", async ({ page }) => {
    const server = await stub(page);
    server.answer = { status: 400, body: { error: { code: "VALIDATION", message: "Check the highlighted fields.", fields: { level: "UNKNOWN_VALUE" } }, request_id: "r" } };
    await page.goto("/me/onboarding?as=student");
    await reachConsent(page);
    await consent(page).check();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "We could not send your answers" })).toBeVisible();
    await page.getByRole("button", { name: "Review my answers" }).click();
    await expect(page.getByText("Step 1 of 4")).toBeVisible();
    await expect(page.getByLabel("Your full name")).toHaveValue("Ada Eze");
  });
});

test.describe("someone who has already finished", () => {
  test("is told so, and is not asked again", async ({ page }) => {
    await stub(page, { onboarded: true, relationship: "student", ref: "SC-ABCDE-FGHJK" });
    await page.goto("/me/onboarding");
    await expect(page.getByRole("heading", { name: "You have already finished" })).toBeVisible();
    await expect(page.getByText("Your reference: SC-ABCDE-FGHJK")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to my page" })).toHaveAttribute("href", "/me");
    await axe(page);
  });
});
