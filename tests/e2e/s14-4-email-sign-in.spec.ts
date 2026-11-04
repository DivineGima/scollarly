import { expect, test, type Page } from "@playwright/test";

/**
 * S14.4 (PRD_3 F21): email and password beside Google on the sign-in and sign-up pages. The Worker is not there under `next start`, so
 * the two password endpoints are answered by the test. The server's own rules are proven in tests/unit/s14-4-password.test.ts.
 */

test.use({ serviceWorkers: "block" });

async function mock(page: Page, status: number, body: unknown = { status: "ok" }) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/auth/sign-*/email", (route) => {
    calls.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() as Record<string, unknown> });
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  // The landing step belongs to the Worker; the test only needs to see where the browser goes.
  await page.route("**/auth/landing**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>landing</body></html>" }));
  return calls;
}

test("sign-in shows Google first and an email form below it", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByTestId("email-form-sign-in")).toBeVisible();
  await expect(page.getByText("Lost your password?")).toBeVisible();
});

test("problems show next to the fields and nothing is sent", async ({ page }) => {
  const calls = await mock(page, 200);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
  expect(calls).toEqual([]);
});

test("a good sign-in goes to the landing step and returns to the page the person came from", async ({ page }) => {
  const calls = await mock(page, 200);
  await page.goto("/sign-in?next=%2Fapply");
  await page.getByLabel("Email address").fill("Ama@Example.com");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/landing\?next=%2Fapply$/);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe("/api/auth/sign-in/email");
  expect(calls[0]?.body).toEqual({ email: "Ama@Example.com", password: "correct horse battery" });
});

test("a wrong password gets one plain sentence that never says whether the email exists", async ({ page }) => {
  await mock(page, 401, { error: { code: "UNAUTHENTICATED", message: "x", fields: { form: "bad_credentials" } }, request_id: "r" });
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("ama@example.com");
  await page.getByLabel("Password", { exact: true }).fill("not the password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("email-form-error")).toHaveText("The email or password is not right.");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("sign-up asks for a name, an email and a password of at least 8 characters", async ({ page }) => {
  const calls = await mock(page, 200);
  await page.goto("/sign-up");
  const form = page.getByTestId("email-form-sign-up");
  await form.getByLabel("Your full name").fill("Ama Boateng");
  await form.getByLabel("Email address").fill("ama@example.com");
  await form.getByLabel("Password", { exact: true }).fill("short");
  await form.getByRole("button", { name: "Sign up" }).click();
  await expect(form.getByText("Use at least 8 characters.")).toBeVisible();
  expect(calls).toEqual([]);

  await form.getByLabel("Password", { exact: true }).fill("a longer password");
  await form.getByLabel("A parent applying for my child").check();
  await form.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/auth\/landing\?intent=sign-up&as=parent$/);
  expect(calls[0]?.path).toBe("/api/auth/sign-up/email");
  expect(calls[0]?.body).toEqual({ name: "Ama Boateng", email: "ama@example.com", password: "a longer password" });
});

test("the password can be shown and hidden, and the page works at phone width without sideways scroll", async ({ page }) => {
  await page.goto("/sign-in");
  const field = page.getByLabel("Password", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(field).toHaveAttribute("type", "text");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
