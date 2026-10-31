import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppNav, type AppNavLabels } from "@/components/shell/app-nav";
import { EmptyState } from "@/components/shell/empty-state";
import { FirstVisitTour } from "@/components/shell/first-visit-tour";
import { PageIntro } from "@/components/shell/page-intro";
import { COURSE_FIELDS, courseOf, isCourseField } from "@/lib/courses";
import { activeItem, moreItemsFor, normalisePath, notificationsHref, tabsFor, TOUR_KEYS } from "@/modules/nav/config";
import { effectiveRole, mintActor } from "@/server/auth/actor";
import { SESSION_COOKIE_NAME } from "@/server/auth/cookie";
import { createAuthFacade } from "@/server/auth/facade";
import { classifyAuthed, AREA_ROLE } from "@/server/edge/authed";
import { handleLegacyRedirect, legacyTarget } from "@/server/edge/legacy-redirects";
import { NEVER_CACHE } from "@/lib/sw-rules";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S13.1 (architecture 21): the pure parts of the refactor's foundations. The database side (the migration, the functions, row level
 * security) is tested in tests/integration/s13-foundations.test.ts.
 */

describe("the tab bar config (21.10, ADR-041)", () => {
  it("gives a student Home, Universities, My progress and Help", () => {
    expect(tabsFor("student").map((tab) => tab.key)).toEqual(["home", "universities", "progress", "help"]);
  });

  it("gives an admin and an owner the same four tabs: Home, Leads, Content, Insights", () => {
    expect(tabsFor("admin").map((tab) => tab.key)).toEqual(["home", "leads", "content", "insights"]);
    expect(tabsFor("owner")).toEqual(tabsFor("admin"));
  });

  it("never offers an admin an owner-only row, and offers the owner all of them", () => {
    const adminKeys = moreItemsFor("admin").map((item) => item.key);
    expect(adminKeys).toEqual(["profile"]);
    expect(moreItemsFor("owner").map((item) => item.key)).toEqual(["profile", "team", "audit", "security", "settings", "health"]);
    expect(moreItemsFor("student").map((item) => item.key)).toEqual(["profile", "data"]);
  });

  it("keeps a screen inside a tab lit under that tab, and the pages behind More under the round button", () => {
    expect(activeItem("admin", "/admin")).toBe("home");
    expect(activeItem("admin", "/en/admin/leads/")).toBe("leads");
    expect(activeItem("admin", "/admin/leads/0190b6a4-0000-7000-8000-000000000000")).toBe("leads");
    expect(activeItem("owner", "/admin/content/university/new")).toBe("content");
    expect(activeItem("owner", "/admin/team")).toBe("more");
    expect(activeItem("admin", "/admin/notifications")).toBe("more");
    expect(activeItem("student", "/me")).toBe("home");
    expect(activeItem("student", "/me/notifications")).toBe("more");
    expect(activeItem("student", "/me/progress")).toBe("progress");
    expect(activeItem("student", "/about")).toBeNull();
  });

  it("lights Home only for the area's own address, not for every address under it", () => {
    expect(activeItem("student", "/me/profile")).toBe("more");
    expect(activeItem("admin", "/admin/unknown-thing")).toBeNull();
  });

  it("strips the locale prefix and trailing slashes", () => {
    expect(normalisePath("/en/me/")).toBe("/me");
    expect(normalisePath("/")).toBe("/");
    expect(normalisePath("/en")).toBe("/");
  });

  it("points each role's Notifications at its own area", () => {
    expect(notificationsHref("student")).toBe("/me/notifications");
    expect(notificationsHref("owner")).toBe("/admin/notifications");
  });

  it("allows a tour for every tab and nothing else", () => {
    const tabs = new Set([...tabsFor("student"), ...tabsFor("admin")].map((tab) => tab.key));
    expect([...tabs].sort()).toEqual([...TOUR_KEYS].sort());
  });
});

const labels: AppNavLabels = {
  nav: "Main tabs",
  tabs: { home: "Home", universities: "Universities", progress: "My progress", help: "Help", leads: "Leads", content: "Content", insights: "Insights" },
  more: "More",
  sheet: {
    title: "More",
    close: "Close",
    notifications: "Notifications",
    unreadCount: (n) => `${n} new`,
    items: { profile: "Profile", data: "My data", team: "Team", audit: "Audit log", security: "Security", settings: "Settings", health: "Health" },
    signOut: "Sign out",
  },
};

describe("the tab bar HTML (FR-19)", () => {
  const html = (role: "student" | "admin" | "owner", over: { unread?: number; path?: string } = {}) => renderToStaticMarkup(createElement(AppNav, { role, labels, path: over.path ?? "/me", unread: over.unread }));

  it("renders every tab as a link with its label, and a round More button", () => {
    const out = html("student");
    for (const label of ["Home", "Universities", "My progress", "Help"]) expect(out).toContain(label);
    expect(out).toContain('href="/me/universities"');
    expect(out).toContain('aria-haspopup="dialog"');
  });

  it("marks the current tab, and only that one", () => {
    const out = html("admin", { path: "/admin/leads" });
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page"[^>]*class="app-nav-tab"[^>]*>.*?Leads|href="\/admin\/leads"[^>]*aria-current="page"/s);
  });

  it("shows the unread dot only when there is something unread", () => {
    expect(html("student", { unread: 0 })).not.toContain("app-nav-dot");
    const out = html("student", { unread: 3 });
    expect(out).toContain("app-nav-dot");
    expect(out).toContain('aria-label="More (3)"');
  });

  it("keeps the sheet closed until it is opened, so no owner-only row is in the HTML", () => {
    const out = html("owner");
    expect(out).not.toContain("Team");
    expect(out).not.toContain('role="dialog"');
  });

  it("loads no admin library and no outside address", () => {
    const sources = ["app-nav.tsx", "more-sheet.tsx", "first-visit-tour.tsx", "page-intro.tsx", "empty-state.tsx", "icons.tsx"].map((file) => readFileSync(`src/components/shell/${file}`, "utf8")).join("\n");
    expect(sources).not.toMatch(/shadcn|recharts|components\/admin|https?:\/\//);
  });
});

describe("page help (FR-21)", () => {
  it("shows the page's purpose under its title", () => {
    const out = renderToStaticMarkup(createElement(PageIntro, { title: "Leads", purpose: "Students waiting for a reply. Tap one to message them." }));
    expect(out).toContain("<h1>Leads</h1>");
    expect(out).toContain("Students waiting for a reply. Tap one to message them.");
  });

  it("makes an empty list say what to do next, with a plain link", () => {
    const out = renderToStaticMarkup(createElement(EmptyState, { title: "No leads yet", next: "Share the apply link.", action: { href: "/apply", label: "Open the apply page" } }));
    expect(out).toContain("No leads yet");
    expect(out).toContain("Share the apply link.");
    expect(out).toContain('href="/apply"');
  });

  it("shows the first step of the tour only to someone who has not seen it, and nothing while that is unknown", () => {
    const tourLabels = { next: "Next", skip: "Skip", done: "Got it", stepOf: (s: number, n: number) => `Step ${s} of ${n}` };
    const base = { tabKey: "leads" as const, steps: [{ title: "Your leads", body: "Everyone waiting on you." }, { title: "Reply", body: "Tap WhatsApp." }], labels: tourLabels, onSeen: () => undefined };
    const unseen = renderToStaticMarkup(createElement(FirstVisitTour, { ...base, seen: false }));
    expect(unseen).toContain("Step 1 of 2");
    expect(unseen).toContain("Your leads");
    expect(renderToStaticMarkup(createElement(FirstVisitTour, { ...base, seen: true }))).toBe("");
    expect(renderToStaticMarkup(createElement(FirstVisitTour, { ...base, seen: null }))).toBe("");
  });
});

describe("the course list (21.7, ADR-044)", () => {
  const seed = JSON.parse(readFileSync("data/seed/universities.json", "utf8")) as { universities?: { programmes: { name: string }[] }[] } | { programmes: { name: string }[] }[];
  const universities = Array.isArray(seed) ? seed : (seed.universities ?? []);
  const names = [...new Set(universities.flatMap((u) => u.programmes.map((p) => p.name)))];

  it("files every programme in the real seed under a field and a level, so none is left unfiled", () => {
    expect(names.length).toBe(28);
    const unfiled = names.filter((name) => courseOf(name) === null);
    expect(unfiled).toEqual([]);
  });

  it("uses only fields from the list", () => {
    for (const name of names) expect(isCourseField(courseOf(name)?.field)).toBe(true);
    expect(isCourseField("astrology")).toBe(false);
  });

  it.each([
    ["B.Tech Computer Science & Engineering", "computer_science_it", "undergraduate"],
    ["B.Sc Computer Science", "computer_science_it", "undergraduate"],
    ["BCA (Bachelor of Computer Applications)", "computer_science_it", "undergraduate"],
    ["MCA (Master of Computer Applications)", "computer_science_it", "postgraduate"],
    ["B.Tech Electronics & Communication Engineering", "electronics_communication_engineering", "undergraduate"],
    ["B.Tech Electronics & Electrical Engineering", "electrical_electronics_engineering", "undergraduate"],
    ["B.Tech Electrical & Electronics Engineering", "electrical_electronics_engineering", "undergraduate"],
    ["M.Tech", "engineering_postgraduate", "postgraduate"],
    ["MBA (Master of Business Administration)", "business_management", "postgraduate"],
    ["BBA", "business_management", "undergraduate"],
    ["M.Com", "commerce", "postgraduate"],
    ["B.Com (Bachelor of Commerce)", "commerce", "undergraduate"],
    ["B.Pharm (Bachelor of Pharmacy)", "pharmacy", "undergraduate"],
    ["B.Sc Nursing", "health_nursing", "undergraduate"],
    ["B.Sc Psychology", "science_arts", "undergraduate"],
    ["M.Sc", "science_arts", "postgraduate"],
    ["B.A. (Arts)", "science_arts", "undergraduate"],
    ["B.Ed (Bachelor of Education)", "science_arts", "undergraduate"],
    ["LLB (Bachelor of Law)", "law", "undergraduate"],
  ])("%s is %s at %s level", (name, field, level) => {
    expect(courseOf(name)).toEqual({ field, level });
  });

  it("returns null for a name no rule recognises, so a new programme is noticed", () => {
    expect(courseOf("Diploma in Basket Weaving")).toBeNull();
  });

  it("has a display name in English and in French for every field", () => {
    for (const field of COURSE_FIELDS) {
      expect((en.courses as Record<string, string>)[field], `en ${field}`).toBeTruthy();
      expect((fr.courses as Record<string, string>)[field], `fr ${field}`).toBeTruthy();
    }
  });
});

describe("the shell translations (FR-32)", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value !== null && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];

  it("has the same keys in English and French", () => {
    expect(keys(fr.shell).sort()).toEqual(keys(en.shell).sort());
    expect(keys(fr.courses).sort()).toEqual(keys(en.courses).sort());
  });

  it("names every tab and every More row the config can show", () => {
    for (const role of ["student", "admin", "owner"] as const) {
      for (const tab of tabsFor(role)) expect((en.shell.tabs as Record<string, string>)[tab.key]).toBeTruthy();
      for (const item of moreItemsFor(role)) expect((en.shell.sheet.items as Record<string, string>)[item.key]).toBeTruthy();
    }
  });
});

describe("the legacy admin addresses (21.5, ADR-049)", () => {
  it.each([
    ["/admin/leads/link-requests", "", "/admin/leads?view=link-requests"],
    ["/admin/data-requests", "", "/admin/leads?view=data-requests"],
    ["/admin/content/stale", "", "/admin/content?view=stale"],
    ["/admin/content/media", "", "/admin/content?view=media"],
    ["/admin/analytics", "", "/admin/insights?view=funnel"],
    ["/admin/analytics/performance", "", "/admin/insights?view=performance"],
    ["/admin/payments", "", "/admin/insights?view=payments"],
    ["/en/admin/payments/", "", "/en/admin/insights?view=payments"],
    ["/admin/payments", "?period=month", "/admin/insights?period=month&view=payments"],
  ])("%s%s moves to %s", (path, search, expected) => {
    expect(legacyTarget(path, search)).toBe(expected);
  });

  it("leaves every other address alone, including the screens that stay", () => {
    for (const path of ["/admin", "/admin/leads", "/admin/leads/0190b6a4-0000-7000-8000-000000000000", "/admin/content", "/admin/team", "/me", "/", "/admin/payments/extra"]) {
      expect(legacyTarget(path, "")).toBeNull();
    }
  });

  it("answers GET and HEAD with a 301 and never touches a POST", () => {
    const get = handleLegacyRedirect(new Request("https://example.test/admin/payments"));
    expect(get?.status).toBe(301);
    expect(get?.headers.get("Location")).toBe("https://example.test/admin/insights?view=payments");
    expect(handleLegacyRedirect(new Request("https://example.test/admin/payments", { method: "HEAD" }))?.status).toBe(301);
    expect(handleLegacyRedirect(new Request("https://example.test/admin/payments", { method: "POST" }))).toBeNull();
    expect(handleLegacyRedirect(new Request("https://example.test/admin/leads"))).toBeNull();
  });

  it("is wired into the Worker (S13.6 did that, with the hubs)", () => {
    expect(readFileSync("worker/index.ts", "utf8")).toContain("legacy-redirects");
  });
});

describe("the account area and the confirmed flag (21.3, ADR-042)", () => {
  it("defaults an actor to confirmed, and keeps an explicit false", () => {
    const base = { userId: "u", sessionId: "s", storedRole: "student" as const, role: "student" as const, twoFactorVerifiedAt: null };
    expect(mintActor(base).accountConfirmed).toBe(true);
    expect(mintActor({ ...base, accountConfirmed: false }).accountConfirmed).toBe(false);
  });

  it("carries the resolver's answer into the actor", async () => {
    const resolve = (accountConfirmed?: boolean) =>
      createAuthFacade(async () => ({ userId: "u", sessionId: "s", email: "a@example.test", emailVerified: true, role: "student", stepUpAt: null, accountConfirmed }));
    const headers = new Headers({ cookie: `${SESSION_COOKIE_NAME}=abcdefghijklmnopqrstuvwxyz012345` });
    expect((await resolve(false).checkSession(headers))?.accountConfirmed).toBe(false);
    expect((await resolve(true).checkSession(headers))?.accountConfirmed).toBe(true);
  });

  it("does not change what a role may do", () => {
    expect(effectiveRole("student", null)).toBe("student");
    expect(effectiveRole("owner", null)).toBe("student");
  });

  it("routes /account to its own area for any signed-in session, and never caches it", () => {
    expect(AREA_ROLE.account).toBe("student");
    expect(classifyAuthed("GET", new URL("https://example.test/account/confirm"), new Headers())).toEqual({ kind: "shell", area: "account" });
    expect(classifyAuthed("GET", new URL("https://example.test/api/v1/account/confirm"), new Headers())).toEqual({ kind: "api", area: "account", name: "confirm" });
    expect(NEVER_CACHE.test("/account/confirm")).toBe(true);
    expect(NEVER_CACHE.test("/en/account/confirm")).toBe(true);
  });
});
