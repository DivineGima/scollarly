import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * Stage 2 screens in a real browser on a production build (`next start`): sign-in (A9), sign-out (A10), the invite page (B0),
 * owner 2FA (C0, C1), the admin shell and the Team, Audit and Security pages (C2, C5, C6, B11).
 *
 * `next start` has no Worker entry, so there is no Neon, no Google and no session here. The edge endpoints are answered by
 * the test (`page.route`) with exactly the shapes and status codes that tests/integration/stage2-auth.test.ts proves the real
 * endpoints return. What these tests prove is the screen: what it shows, what it sends, what it does with each answer.
 * The real Google round trip is measured by hand (tracker, S2.2).
 */

// The service worker (S0.8) would answer fetches itself, outside page.route; these tests are about the screens, so it is off.
test.use({ serviceWorkers: "block" });

const TOKEN = "A".repeat(43);
/** Next.js keeps its own role=alert element for route announcements; it is not ours. */
const alerts = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
const fail = (route: Route, status: number, code: string, fields: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  json(route, { error: { code, message: code, fields }, request_id: "r" }, status, headers);

/** For a page that sends the person on as soon as it loads: wait for the navigation to start, not for a load that is cancelled. */
const leaves = (page: Page, path: string) => page.goto(path, { waitUntil: "commit" }).catch(() => undefined);

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe("A9 sign in", () => {
  test("has one Google button that is a plain link to /auth/start, the no-Google line, and passes axe", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    const button = page.getByRole("link", { name: "Continue with Google" });
    await expect(button).toHaveAttribute("href", "/auth/start");
    await expect(page.getByText("No Google account? You can still apply and message us on WhatsApp.")).toBeVisible();
    await expect(alerts(page)).toHaveCount(0);
    await axe(page);
  });

  test("says plainly why the person came back, and nothing for an unknown reason", async ({ page }) => {
    await page.goto("/sign-in?error=cancelled");
    await expect(alerts(page)).toHaveText("Sign-in was cancelled. Nothing was changed.");
    await axe(page);
    await page.goto("/sign-in?error=failed");
    await expect(alerts(page)).toContainText("could not sign you in");
    await page.goto("/sign-in?error=unavailable");
    await expect(alerts(page)).toContainText("not available right now");
    await page.goto("/sign-in?error=%3Cscript%3E");
    await expect(alerts(page)).toHaveCount(0);
  });

  test("tells an offline visitor that sign-in needs a connection", async ({ page, context }) => {
    await page.goto("/sign-in");
    await context.setOffline(true);
    await expect(page.getByRole("status")).toHaveText("You need a connection to sign in.");
    await context.setOffline(false);
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});

test.describe("A10 sign out", () => {
  test("ends the session and goes to the home page", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/auth/sign-out", (route) => {
      calls += 1;
      return json(route, { success: true });
    });
    await page.goto("/sign-out");
    await expect(page).toHaveURL(/\/$/);
    expect(calls).toBe(1);
  });

  test("shows an error and a retry button when the server cannot be reached, then succeeds", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/auth/sign-out", (route) => {
      calls += 1;
      return calls === 1 ? route.abort("failed") : json(route, { success: true });
    });
    await page.goto("/sign-out");
    await expect(alerts(page)).toHaveText("We could not sign you out.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(calls).toBe(2);
  });
});

test.describe("B0 accept an invite", () => {
  test("shows the invited email and carries the token through Google sign-in", async ({ page }) => {
    await page.route("**/api/v1/invites/check", (route) => {
      expect(route.request().postDataJSON()).toEqual({ token: TOKEN });
      return json(route, { status: "open", email: "priya@example.test" });
    });
    await page.goto(`/accept-invite/${TOKEN}`);
    await expect(page.getByRole("heading", { name: "You were invited as an admin" })).toBeVisible();
    await expect(page.getByText("This invite is for priya@example.test.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", `/auth/start?invite=${TOKEN}`);
    await axe(page);
  });

  test("explains a wrong Google account after the landing step sends the person back", async ({ page }) => {
    await page.route("**/api/v1/invites/check", (route) => json(route, { status: "open", email: "priya@example.test" }));
    await page.goto(`/accept-invite/${TOKEN}?error=1`);
    await expect(alerts(page)).toContainText("Sign in with priya@example.test");
  });

  test("says the same thing for an unusable link, and does not even ask the server about a malformed one", async ({ page }) => {
    await page.route("**/api/v1/invites/check", (route) => json(route, { status: "unusable" }));
    await page.goto(`/accept-invite/${TOKEN}`);
    await expect(alerts(page)).toHaveText("This invite can't be used. Ask the owner for a new one.");
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);

    let asked = false;
    await page.unroute("**/api/v1/invites/check");
    await page.route("**/api/v1/invites/check", (route) => {
      asked = true;
      return json(route, { status: "open", email: "x@example.test" });
    });
    await page.goto("/accept-invite/not-a-token");
    await expect(alerts(page)).toContainText("can't be used");
    expect(asked).toBe(false);
  });

  test("offers a retry when the check cannot be made", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/v1/invites/check", (route) => {
      calls += 1;
      return calls === 1 ? route.abort("failed") : json(route, { status: "open", email: "priya@example.test" });
    });
    await page.goto(`/accept-invite/${TOKEN}`);
    await expect(alerts(page)).toContainText("could not check the invite");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("This invite is for priya@example.test.")).toBeVisible();
  });
});

const status = (over: Partial<{ enrolled: boolean; pending: boolean; verified: boolean; stepUpFresh: boolean }> = {}) => ({
  enrolled: false,
  pending: false,
  verified: false,
  stepUpFresh: false,
  ...over,
});

test.describe("C0 first sign-in as owner: enrol two-factor", () => {
  const RECOVERY = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-DD${String(i).padStart(2, "0")}`);

  async function mockEnrol(page: Page) {
    await page.route("**/api/v1/auth/two-factor-status", (route) => json(route, status()));
    await page.route("**/api/v1/auth/twoFactor.begin", (route) =>
      json(route, { otpauthUri: "otpauth://totp/Scollarly:owner%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Scollarly", secret: "JBSWY3DPEHPK3PXP" }),
    );
    await page.route("**/api/v1/auth/twoFactor.confirm", (route) =>
      route.request().postDataJSON().code === "123456" ? json(route, { verified: true, recoveryCodes: RECOVERY }) : fail(route, 400, "VALIDATION", { code: "INVALID_CODE" }),
    );
  }

  test("shows a QR code and the key, refuses a wrong code, then shows ten recovery codes once", async ({ page }) => {
    await mockEnrol(page);
    await page.goto("/two-factor/enrol");
    await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
    await expect(page.getByAltText("QR code for your authenticator app")).toHaveAttribute("src", /^data:image\/gif/);
    await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
    await axe(page);

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(alerts(page)).toHaveText("That code is not right.");

    await page.getByLabel("6-digit code").fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
    await expect(page.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
    await expect(page.getByAltText("QR code for your authenticator app")).toHaveCount(0);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toBe("scollarly-recovery-codes.txt");
  });

  test("asks for one secret only, even when the page is shown twice", async ({ page }) => {
    let begins = 0;
    await mockEnrol(page);
    await page.route("**/api/v1/auth/twoFactor.begin", (route) => {
      begins += 1;
      return json(route, { otpauthUri: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP", secret: "JBSWY3DPEHPK3PXP" });
    });
    await page.goto("/two-factor/enrol");
    await expect(page.getByAltText("QR code for your authenticator app")).toBeVisible();
    expect(begins).toBe(1);
  });

  test("sends an owner who is already enrolled to the code prompt, and a visitor to sign in", async ({ page }) => {
    await page.route("**/api/v1/auth/two-factor-status", (route) => json(route, status({ enrolled: true })));
    await leaves(page, "/two-factor/enrol");
    await expect(page).toHaveURL(/\/two-factor\/verify$/);

    await page.unroute("**/api/v1/auth/two-factor-status");
    await page.route("**/api/v1/auth/two-factor-status", (route) => fail(route, 401, "UNAUTHENTICATED"));
    await leaves(page, "/two-factor/enrol");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("tells a signed-in person who is not the owner that the page is not theirs, and survives a server error", async ({ page }) => {
    await page.route("**/api/v1/auth/two-factor-status", (route) => fail(route, 403, "FORBIDDEN"));
    await page.goto("/two-factor/enrol");
    await expect(alerts(page)).toHaveText("This page is for the owner only.");

    await page.unroute("**/api/v1/auth/two-factor-status");
    await page.route("**/api/v1/auth/two-factor-status", (route) => fail(route, 500, "INTERNAL"));
    await page.goto("/two-factor/enrol");
    await expect(alerts(page)).toContainText("could not load this page");
  });
});

test.describe("C1 later sign-ins: the code prompt", () => {
  test("accepts a code and goes to /admin; shows each failure in words", async ({ page }) => {
    await page.route("**/api/v1/auth/two-factor-status", (route) => json(route, status({ enrolled: true })));
    const answers: Record<string, () => { status: number; body: unknown; headers?: Record<string, string> }> = {
      "111111": () => ({ status: 400, body: { error: { code: "VALIDATION", message: "x", fields: { code: "INVALID_CODE" } }, request_id: "r" } }),
      "222222": () => ({ status: 400, body: { error: { code: "VALIDATION", message: "x", fields: { code: "CODE_ALREADY_USED" } }, request_id: "r" } }),
      "333333": () => ({ status: 429, body: { error: { code: "RATE_LIMITED", message: "x" }, request_id: "r" }, headers: { "Retry-After": "900" } }),
      "444444": () => ({ status: 500, body: { error: { code: "INTERNAL", message: "x" }, request_id: "r" } }),
    };
    await page.route("**/api/v1/auth/twoFactor.verify", (route) => {
      const answer = answers[route.request().postDataJSON().code as string];
      return answer ? json(route, answer().body, answer().status, answer().headers) : json(route, { verified: true });
    });
    await page.goto("/two-factor/verify");
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await axe(page);

    const expectError = async (code: string, text: RegExp) => {
      await page.getByLabel("6-digit code").fill(code);
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(alerts(page)).toHaveText(text);
    };
    await expectError("111111", /That code is not right\./);
    await expectError("222222", /already used/);
    await expectError("333333", /Too many wrong codes\. Try again in 15 minutes\./);
    await expectError("444444", /Something went wrong/);

    await page.getByLabel("6-digit code").fill("654321");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("uses a recovery code through its own endpoint", async ({ page }) => {
    await page.route("**/api/v1/auth/two-factor-status", (route) => json(route, status({ enrolled: true })));
    let recoveryBody: unknown = null;
    await page.route("**/api/v1/auth/twoFactor.recovery", (route) => {
      recoveryBody = route.request().postDataJSON();
      return json(route, { verified: true });
    });
    await page.goto("/two-factor/verify");
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill("AAAA-BBBB-CCCC-DDDD");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect(recoveryBody).toEqual({ code: "AAAA-BBBB-CCCC-DDDD" });
  });

  test("sends an owner who has not enrolled to enrol, and one who is already verified to /admin", async ({ page }) => {
    await page.route("**/api/v1/auth/two-factor-status", (route) => json(route, status()));
    await page.route("**/api/v1/auth/twoFactor.begin", (route) => json(route, { otpauthUri: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP", secret: "JBSWY3DPEHPK3PXP" }));
    await leaves(page, "/two-factor/verify");
    await expect(page).toHaveURL(/\/two-factor\/enrol$/);

    await page.unroute("**/api/v1/auth/two-factor-status");
    await page.route("**/api/v1/auth/two-factor-status", (route) => json(route, status({ enrolled: true, verified: true })));
    await leaves(page, "/two-factor/verify");
    await expect(page).toHaveURL(/\/admin$/);
  });
});

// ---- The admin shell and its screens -------------------------------------------------------------------------------------

const OWNER = { role: "owner", name: "Boss", email: "boss@example.test", stepUpFresh: true };
const ADMIN = { role: "admin", name: "Priya", email: "priya@example.test", stepUpFresh: false };

const sessionHolders = new WeakMap<Page, { current: typeof OWNER | typeof ADMIN }>();
async function asRole(page: Page, session: typeof OWNER | typeof ADMIN) {
  const held = sessionHolders.get(page);
  if (held) {
    held.current = session; // the same route answers with the new role
    return;
  }
  const holder = { current: session };
  sessionHolders.set(page, holder);
  await page.route("**/api/v1/admin/session", (route) => json(route, holder.current));
}

test.describe("S2.6 the admin shell", () => {
  test("shows an admin only Overview, Profile and Sign out, and the owner everything", async ({ page }) => {
    await asRole(page, ADMIN);
    await page.goto("/admin");
    const menu = page.getByRole("navigation", { name: "Admin menu" });
    await expect(menu.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link")).toHaveText(["Overview", "Profile", "Sign out"]);
    await expect(page.getByText("Welcome, Priya.")).toBeVisible();
    await expect(page.getByText("priya@example.test")).toBeVisible();
    await axe(page);

    await asRole(page, OWNER);
    await page.goto("/admin");
    await expect(menu.getByRole("link")).toHaveText(["Overview", "Profile", "Team", "Audit log", "Security", "Sign out"]);
  });

  test("an admin who opens an owner page sees nothing of it", async ({ page }) => {
    await asRole(page, ADMIN);
    let asked = false;
    for (const name of ["team", "audit", "security"]) {
      await page.route(`**/api/v1/admin/${name}*`, (route) => {
        asked = true;
        return fail(route, 403, "FORBIDDEN");
      });
    }
    for (const path of ["/admin/team", "/admin/audit", "/admin/security"]) {
      await page.goto(path);
      await expect(page.getByText("Welcome")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
    }
    expect(asked).toBe(false);
  });

  test("sends a lost session to sign-in, and shows an error with a retry when the server fails", async ({ page }) => {
    await page.route("**/api/v1/admin/session", (route) => fail(route, 401, "UNAUTHENTICATED"));
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.unroute("**/api/v1/admin/session");
    let calls = 0;
    await page.route("**/api/v1/admin/session", (route) => {
      calls += 1;
      return calls === 1 ? fail(route, 500, "INTERNAL") : json(route, ADMIN);
    });
    await page.goto("/admin");
    await expect(alerts(page)).toContainText("could not load this page");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Welcome, Priya.")).toBeVisible();
  });

  test("warns when the phone is offline", async ({ page, context }) => {
    await asRole(page, ADMIN);
    await page.goto("/admin");
    await context.setOffline(true);
    await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toHaveCount(0);
  });

  test("B11: saves the name and signs out other devices", async ({ page }) => {
    await asRole(page, ADMIN);
    let saved: unknown = null;
    await page.route("**/api/v1/admin/profile.setName", (route) => {
      saved = route.request().postDataJSON();
      return json(route, { saved: true });
    });
    await page.route("**/api/v1/admin/profile.signOutOthers", (route) => json(route, { ended: 2 }));
    await page.goto("/admin/profile");
    await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
    await expect(page.getByLabel("Email (from Google)")).toHaveValue("priya@example.test");
    await expect(page.getByLabel("Email (from Google)")).toHaveAttribute("readonly", "");
    await page.getByLabel("Name").fill("Priya Nair");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    expect(saved).toEqual({ name: "Priya Nair" });
    await page.getByRole("button", { name: "Sign out of other devices" }).click();
    await expect(page.getByText("Signed out of 2 other sessions.")).toBeVisible();
    await axe(page);
  });
});

test.describe("C2 team", () => {
  const TEAM = {
    members: [
      { userId: "o1", email: "boss@example.test", name: "Boss", role: "owner", leadsHeld: 0, since: "2026-10-01T10:00:00.000Z", isYou: true },
      { userId: "a1", email: "priya@example.test", name: "Priya", role: "admin", leadsHeld: 3, since: "2026-10-02T10:00:00.000Z", isYou: false },
      { userId: "a2", email: "ravi@example.test", name: "Ravi", role: "admin", leadsHeld: 1, since: "2026-10-03T10:00:00.000Z", isYou: false },
    ],
    invites: [
      { id: "11111111-1111-4111-8111-111111111111", email: "new@example.test", createdAt: "2026-10-23T10:00:00.000Z", expiresAt: "2099-10-30T10:00:00.000Z", state: "open" },
      { id: "22222222-2222-4222-8222-222222222222", email: "old@example.test", createdAt: "2026-09-01T10:00:00.000Z", expiresAt: "2026-09-08T10:00:00.000Z", state: "expired" },
    ],
  };

  test("lists admins with their leads and the pending invites, expired ones marked, and passes axe", async ({ page }) => {
    await asRole(page, OWNER);
    await page.route("**/api/v1/admin/team", (route) => json(route, TEAM));
    await page.goto("/admin/team");
    await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    await expect(page.getByRole("row", { name: /priya@example.test/ })).toContainText("3");
    await expect(page.getByRole("row", { name: /boss@example.test/ })).toContainText("(You)");
    await expect(page.getByRole("row", { name: /boss@example.test/ }).getByRole("button")).toHaveCount(0); // the owner cannot be removed
    await expect(page.getByText("Expired")).toBeVisible();
    await axe(page);
  });

  test("invites: asks for a fresh code when the server wants one, then shows the link once and copies it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await asRole(page, OWNER);
    await page.route("**/api/v1/admin/team", (route) => json(route, TEAM));
    let invites = 0;
    let verifies = 0;
    await page.route("**/api/v1/admin/team.invite", (route) => {
      invites += 1;
      expect(route.request().postDataJSON()).toEqual({ email: "fresh@example.test" });
      return invites === 1
        ? fail(route, 403, "STEP_UP_REQUIRED")
        : json(route, { id: "x", email: "fresh@example.test", expiresAt: "2099-01-01T00:00:00.000Z", link: `https://scollarly.example/accept-invite/${TOKEN}` }, 201);
    });
    await page.route("**/api/v1/auth/twoFactor.verify", (route) => {
      verifies += 1;
      return route.request().postDataJSON().code === "123456" ? json(route, { verified: true }) : fail(route, 400, "VALIDATION", { code: "INVALID_CODE" });
    });

    await page.goto("/admin/team");
    await page.getByRole("button", { name: "Invite admin" }).first().click();
    await page.getByLabel("Google email address").fill("fresh@example.test");
    await page.getByRole("button", { name: "Create invite link" }).click();

    const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("6-digit code").fill("000000");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("That code is not right.");
    await dialog.getByLabel("6-digit code").fill("123456");
    await dialog.getByRole("button", { name: "Confirm" }).click();

    const linkDialog = page.getByRole("dialog", { name: "Invite link" });
    await expect(linkDialog.getByLabel("Invite link")).toHaveValue(`https://scollarly.example/accept-invite/${TOKEN}`);
    await linkDialog.getByRole("button", { name: "Copy link" }).click();
    await expect(linkDialog.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://scollarly.example/accept-invite/${TOKEN}`);
    expect(invites).toBe(2);
    expect(verifies).toBe(2);
  });

  test("invites: cancelling the code prompt changes nothing; a team member and a bad address get their own message", async ({ page }) => {
    await asRole(page, OWNER);
    await page.route("**/api/v1/admin/team", (route) => json(route, TEAM));
    let invites = 0;
    await page.route("**/api/v1/admin/team.invite", (route) => {
      invites += 1;
      const email = route.request().postDataJSON().email as string;
      if (email === "priya@example.test") return fail(route, 409, "CONFLICT", { email: "ALREADY_STAFF" });
      if (email === "bad") return fail(route, 400, "VALIDATION", { email: "Invalid email address" });
      return fail(route, 403, "STEP_UP_REQUIRED");
    });
    await page.goto("/admin/team");
    await page.getByRole("button", { name: "Invite admin" }).first().click();
    const email = page.getByLabel("Google email address");

    await email.fill("priya@example.test");
    await page.getByRole("button", { name: "Create invite link" }).click();
    await expect(alerts(page)).toHaveText("That person is already on the team.");
    await email.fill("bad");
    await page.getByRole("button", { name: "Create invite link" }).click();
    await expect(alerts(page)).toHaveText("Enter a valid email address.");

    await email.fill("someone@example.test");
    await page.getByRole("button", { name: "Create invite link" }).click();
    await page.getByRole("dialog", { name: "Confirm it's you" }).getByRole("button", { name: "Use a recovery code" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Confirm it's you" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Invite an admin" })).toBeVisible();
    await expect(alerts(page)).toBeVisible();
    expect(invites).toBe(3);
  });

  test("resends an invite (same call as inviting) and revokes another", async ({ page }) => {
    await asRole(page, OWNER);
    let list = 0;
    await page.route("**/api/v1/admin/team", (route) => {
      list += 1;
      return json(route, TEAM);
    });
    let posted: unknown = null;
    await page.route("**/api/v1/admin/team.invite", (route) => {
      posted = route.request().postDataJSON();
      return json(route, { id: "x", email: "new@example.test", expiresAt: "2099-01-01T00:00:00.000Z", link: `https://scollarly.example/accept-invite/${TOKEN}` }, 201);
    });
    let revoked: unknown = null;
    await page.route("**/api/v1/admin/team.revokeInvite", (route) => {
      revoked = route.request().postDataJSON();
      return json(route, { revoked: true });
    });
    await page.goto("/admin/team");
    const row = (email: string) => page.getByRole("listitem").filter({ hasText: email });

    await row("new@example.test").getByRole("button", { name: "Resend" }).click();
    await expect(page.getByRole("dialog", { name: "Invite link" })).toBeVisible();
    expect(posted).toEqual({ email: "new@example.test" });
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

    const before = list;
    await row("old@example.test").getByRole("button", { name: "Revoke" }).click();
    await expect.poll(() => list).toBeGreaterThan(before);
    expect(revoked).toEqual({ id: "22222222-2222-4222-8222-222222222222" });
  });

  test("removes an admin after saying how many leads return to the pool, and asks for a code first if needed", async ({ page }) => {
    await asRole(page, OWNER);
    await page.route("**/api/v1/admin/team", (route) => json(route, TEAM));
    let removeCalls = 0;
    await page.route("**/api/v1/admin/team.removeAdmin", (route) => {
      removeCalls += 1;
      expect(route.request().postDataJSON()).toEqual({ userId: "a1" });
      return removeCalls === 1 ? fail(route, 403, "STEP_UP_REQUIRED") : json(route, { removed: true, leadsReleased: 3 });
    });
    await page.route("**/api/v1/auth/twoFactor.verify", (route) => json(route, { verified: true }));
    await page.goto("/admin/team");

    await page.getByRole("row", { name: /ravi@example.test/ }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("dialog", { name: "Remove this admin?" })).toContainText("They hold 1 lead, which will return to the unassigned pool.");
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("row", { name: /priya@example.test/ }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("dialog", { name: "Remove this admin?" })).toContainText("They hold 3 leads, which will return to the unassigned pool.");
    await page.getByRole("button", { name: "Remove admin" }).click();
    await page.getByRole("dialog", { name: "Confirm it's you" }).getByLabel("6-digit code").fill("123456");
    await page.getByRole("dialog", { name: "Confirm it's you" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("dialog", { name: "Remove this admin?" })).toHaveCount(0);
    expect(removeCalls).toBe(2);
  });
});

test.describe("C5 audit log", () => {
  const AUDIT = (extra: Partial<{ nextBefore: string | null }> = {}) => ({
    entries: [
      { id: "e1", at: "2026-10-23T22:30:00.000Z", actorId: "o1", actorEmail: "boss@example.test", action: "team.invite", entityType: "admin_invite", entityId: "i1", meta: {} },
      { id: "e2", at: "2026-10-23T10:00:00.000Z", actorId: "gone", actorEmail: null, action: "team.removeAdmin", entityType: "app_user", entityId: "gone", meta: {} },
      { id: "e3", at: "2026-10-22T10:00:00.000Z", actorId: null, actorEmail: null, action: "brand.new.action", entityType: "thing", entityId: null, meta: {} },
    ],
    people: [{ id: "o1", email: "boss@example.test" }],
    actions: ["team.invite", "team.removeAdmin"],
    nextBefore: null,
    ...extra,
  });

  test("lists entries newest first in WAT with readable actions, and filters through the server", async ({ page }) => {
    await asRole(page, OWNER);
    const urls: string[] = [];
    await page.route("**/api/v1/admin/audit*", (route) => {
      urls.push(route.request().url());
      return json(route, AUDIT());
    });
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    // 22:30 UTC is 23:30 WAT the same day; 23 October 22:30Z must not be shown as 22:30.
    await expect(page.getByRole("row", { name: /Invited an admin/ })).toContainText("2026-10-23 23:30 WAT");
    await expect(page.getByRole("row", { name: /Removed an admin/ })).toContainText("Former team member");
    await expect(page.getByRole("row", { name: /brand.new.action/ })).toContainText("System");
    await axe(page);

    await page.getByLabel("Action").selectOption("team.invite");
    await page.getByLabel("From").fill("2026-10-01");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect.poll(() => urls.at(-1)).toContain("action=team.invite");
    expect(urls.at(-1)).toContain("from=2026-10-01");
  });

  test("shows older entries on request and an empty state, and says when the filters are impossible", async ({ page }) => {
    await asRole(page, OWNER);
    let calls = 0;
    await page.route("**/api/v1/admin/audit*", (route) => {
      calls += 1;
      const url = new URL(route.request().url());
      if (url.searchParams.has("from") && url.searchParams.has("to") && url.searchParams.get("from")! > url.searchParams.get("to")!) return fail(route, 400, "VALIDATION");
      if (url.searchParams.get("action") === "team.invite") return json(route, { ...AUDIT(), entries: [], nextBefore: null });
      if (url.searchParams.has("before")) return json(route, { ...AUDIT(), entries: [AUDIT().entries[2]], nextBefore: null });
      return json(route, AUDIT({ nextBefore: "2026-10-22T10:00:00.000Z_e3" }));
    });
    await page.goto("/admin/audit");
    await page.getByRole("button", { name: "Show older entries" }).click();
    await expect(page.getByRole("row")).toHaveCount(1 + 3 + 1);
    await expect(page.getByRole("button", { name: "Show older entries" })).toHaveCount(0);

    await page.getByLabel("Action").selectOption("team.invite");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("Nothing recorded for these filters.")).toBeVisible();

    await page.getByLabel("Action").selectOption("");
    await page.getByLabel("From").fill("2026-05-02");
    await page.getByLabel("To").fill("2026-05-01");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(alerts(page)).toContainText("Check the dates");
    expect(calls).toBeGreaterThan(3);
  });
});

test.describe("C6 security", () => {
  const SECURITY = {
    twoFactorEnabled: true,
    sessions: [
      { createdAt: "2026-10-24T09:00:00.000Z", expiresAt: "2026-10-31T09:00:00.000Z", isCurrent: true },
      { createdAt: "2026-10-20T09:00:00.000Z", expiresAt: "2026-10-27T09:00:00.000Z", isCurrent: false },
    ],
  };

  test("shows 2FA status and sessions, makes new recovery codes after a code prompt, and signs out elsewhere", async ({ page }) => {
    await asRole(page, OWNER);
    await page.route("**/api/v1/admin/security", (route) => json(route, SECURITY));
    let regenerate = 0;
    await page.route("**/api/v1/admin/security.regenerateRecoveryCodes", (route) => {
      regenerate += 1;
      return regenerate === 1 ? fail(route, 403, "STEP_UP_REQUIRED") : json(route, { recoveryCodes: Array.from({ length: 10 }, (_, i) => `NEW0-CODE-000${i}-ABCD`) });
    });
    await page.route("**/api/v1/auth/twoFactor.verify", (route) => json(route, { verified: true }));
    await page.route("**/api/v1/admin/security.signOutEverywhere", (route) => json(route, { ended: 1 }));
    await page.goto("/admin/security");
    await expect(page.getByText("On. Your authenticator app is required at every sign-in.")).toBeVisible();
    await expect(page.getByText("This session")).toHaveCount(1);
    await axe(page);

    await page.getByRole("button", { name: "Make new recovery codes" }).click();
    await page.getByRole("dialog", { name: "Confirm it's you" }).getByLabel("6-digit code").fill("123456");
    await page.getByRole("dialog", { name: "Confirm it's you" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
    await page.getByRole("button", { name: "I saved them" }).click();

    await page.getByRole("button", { name: "Sign out everywhere else" }).click();
    await expect(page.getByText("Signed out of 1 other sessions.")).toBeVisible();
  });
});

test("the admin pages work at 375 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await asRole(page, OWNER);
  await page.route("**/api/v1/admin/team", (route) =>
    json(route, {
      members: [{ userId: "a1", email: "a.very.long.address.for.layout@example-university-partner.test", name: "A Very Long Name Indeed", role: "admin", leadsHeld: 12, since: "2026-10-02T10:00:00.000Z", isYou: false }],
      invites: [],
    }),
  );
  await page.goto("/admin/team");
  await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
