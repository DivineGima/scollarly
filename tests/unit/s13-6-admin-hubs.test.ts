import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineChart, niceMax } from "@/components/admin/charts/line-chart";
import { tilesOf } from "@/components/admin/admin-home";
import { changeOf, dollarsFromCents, fillSeries, PERIOD_DAYS, periodWindows, readPeriod } from "@/modules/dashboard/periods";
import { activeItem, moreItemsFor, tabsFor, TOUR_KEYS } from "@/modules/nav/config";
import { isKeptShell } from "@/lib/sw-rules";
import { legacyTarget } from "@/server/edge/legacy-redirects";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S13.6 (architecture 21.9, 21.10): the staff Home's maths, the hand-built chart, the tiles of each role, the tabs and the More rows, the
 * old addresses, and the words. What each role is shown by the database is in tests/integration/s13-6-admin-hubs.test.ts.
 */

const at = (iso: string) => new Date(iso);

describe("the periods (WAT week and month)", () => {
  // 2026-11-04 14:00 UTC is 15:00 WAT on Wednesday the 4th.
  const now = at("2026-11-04T14:00:00Z");

  it("takes the last 7 WAT days, today included, against the 7 before", () => {
    const w = periodWindows(now, "week");
    expect(w.days).toBe(7);
    expect(w.curEnd.toISOString()).toBe("2026-11-04T23:00:00.000Z"); // the end of Wednesday 4th, 00:00 WAT on the 5th
    expect(w.curStart.toISOString()).toBe("2026-10-28T23:00:00.000Z"); // 00:00 WAT on Thursday the 29th
    expect(w.prevStart.toISOString()).toBe("2026-10-21T23:00:00.000Z");
    expect(w.labels).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  it("takes the last 30 days for a month", () => {
    const w = periodWindows(now, "month");
    expect(PERIOD_DAYS.month).toBe(30);
    expect(w.labels).toHaveLength(30);
    expect(w.labels[0]).toBe("2026-10-06");
    expect(w.labels.at(-1)).toBe("2026-11-04");
    expect(w.curStart.getTime() - w.prevStart.getTime()).toBe(30 * 86_400_000);
  });

  it("changes day at midnight West Africa Time, not at midnight UTC", () => {
    // 22:59 UTC on the 4th is still the 4th in WAT; 23:00 UTC is the 5th.
    expect(periodWindows(at("2026-11-04T22:59:00Z"), "week").labels.at(-1)).toBe("2026-11-04");
    expect(periodWindows(at("2026-11-04T23:00:00Z"), "week").labels.at(-1)).toBe("2026-11-05");
  });

  it("works across a month and a year end", () => {
    expect(periodWindows(at("2027-01-02T10:00:00Z"), "week").labels).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("reads anything but 'month' as the week", () => {
    expect(readPeriod("month")).toBe("month");
    expect(readPeriod("week")).toBe("week");
    expect(readPeriod("year")).toBe("week");
    expect(readPeriod(null)).toBe("week");
  });
});

describe("the series and the change", () => {
  const labels = ["2026-11-01", "2026-11-02", "2026-11-03"];

  it("fills a day with nothing as zero and ignores a day outside the period", () => {
    expect(fillSeries(labels, [{ day: "2026-11-02", n: 4 }, { day: "2026-10-01", n: 9 }])).toEqual([
      { label: "2026-11-01", value: 0 },
      { label: "2026-11-02", value: 4 },
      { label: "2026-11-03", value: 0 },
    ]);
    expect(fillSeries(labels, [])).toEqual(labels.map((label) => ({ label, value: 0 })));
  });

  it("accepts a day that carries a time", () => {
    expect(fillSeries(labels, [{ day: "2026-11-03T00:00:00.000Z", n: 2 }]).at(-1)?.value).toBe(2);
  });

  it("compares with the period before: up, down, the same, and no percentage of nothing", () => {
    expect(changeOf(12, 8)).toEqual({ delta: 4, percent: 50, direction: "up" });
    expect(changeOf(2, 6)).toEqual({ delta: -4, percent: -67, direction: "down" });
    expect(changeOf(3, 3)).toEqual({ delta: 0, percent: 0, direction: "same" });
    expect(changeOf(5, 0)).toEqual({ delta: 5, percent: null, direction: "up" });
    expect(changeOf(0, 0)).toEqual({ delta: 0, percent: null, direction: "same" });
  });

  it("has no change for a number that is only true right now", () => {
    expect(changeOf(7, null)).toBeNull();
  });

  it("writes money in dollars from cents", () => {
    expect(dollarsFromCents(250_000)).toBe("$2,500");
    expect(dollarsFromCents(0)).toBe("$0");
    expect(dollarsFromCents(1_500_000_00)).toBe("$1,500,000");
  });
});

describe("the tiles (four at most, by role)", () => {
  const totals = (extra: Record<string, unknown> = {}) =>
    ({
      newLeads: { value: 12, previous: 8 },
      waiting: 5,
      overdue: 2,
      stageMoves: { value: 3, previous: 3 },
      pendingClaims: 1,
      openDataRequests: 0,
      payments: null,
      onboarded: null,
      ...extra,
    }) as never;

  it("gives an admin their working numbers", () => {
    const tiles = tilesOf({ role: "admin", totals: totals() });
    expect(tiles.map((t) => t.key)).toEqual(["newLeads", "waiting", "overdue", "stageMoves"]);
    expect(tiles.find((t) => t.key === "waiting")?.previous).toBeNull();
  });

  it("gives the owner new leads, overdue, payments and onboardings, and no admin-only tile", () => {
    const tiles = tilesOf({ role: "owner", totals: totals({ payments: { valueCents: 250_000, previousCents: 100_000 }, onboarded: { value: 4, previous: 6 } }) });
    expect(tiles.map((t) => t.key)).toEqual(["newLeads", "overdue", "payments", "onboarded"]);
    expect(tiles.find((t) => t.key === "payments")?.text).toBe("$2,500");
    expect(tiles).toHaveLength(4);
  });

  it("does not break for an owner whose owner-only numbers are missing", () => {
    const tiles = tilesOf({ role: "owner", totals: totals() });
    expect(tiles.find((t) => t.key === "payments")?.text).toBe("$0");
    expect(tiles.find((t) => t.key === "onboarded")?.value).toBe(0);
  });
});

describe("the hand-built line chart", () => {
  const props = { caption: "New leads each day", columns: { label: "Day", value: "New leads" }, empty: "No new leads yet." };
  const render = (points: { label: string; value: number }[]) => renderToStaticMarkup(createElement(LineChart, { ...props, points }));

  it("has a caption, an accessible name and a data table for screen readers", () => {
    const html = render([{ label: "2026-11-01", value: 1 }, { label: "2026-11-02", value: 3 }]);
    expect(html).toContain("<figcaption");
    expect(html).toContain("New leads each day");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-labelledby="line-chart-caption"');
    expect(html).toContain("<table");
    expect(html).toContain("2026-11-02");
  });

  it("draws nothing, and says why, when there is nothing to draw", () => {
    for (const points of [[], [{ label: "2026-11-01", value: 0 }, { label: "2026-11-02", value: 0 }]]) {
      const html = render(points);
      expect(html).toContain("No new leads yet.");
      expect(html).not.toContain("<svg");
    }
  });

  it("draws one point without dividing by zero", () => {
    const html = render([{ label: "2026-11-01", value: 5 }]);
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
  });

  it("copes with a large series and a large value", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ label: `2026-10-${String(i + 1).padStart(2, "0")}`, value: i === 12 ? 1_234_567 : i }));
    const html = render(points);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect((html.match(/<circle/g) ?? []).length).toBe(30);
  });

  it("rounds the top of the scale up to a round number", () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(3)).toBe(4);
    expect(niceMax(8)).toBe(10);
    expect(niceMax(14)).toBe(20);
    expect(niceMax(150)).toBe(200);
    expect(niceMax(1_234_567)).toBe(2_000_000);
  });
});

describe("the bar for staff (architecture 21.10)", () => {
  it("has the same four tabs for an admin and the owner", () => {
    expect(tabsFor("admin").map((t) => t.href)).toEqual(["/admin", "/admin/leads", "/admin/content", "/admin/insights"]);
    expect(tabsFor("owner")).toEqual(tabsFor("admin"));
  });

  it("shows an admin Profile only, and the owner the five owner-only pages as well", () => {
    expect(moreItemsFor("admin").map((i) => i.key)).toEqual(["profile"]);
    expect(moreItemsFor("owner").map((i) => i.key)).toEqual(["profile", "team", "audit", "security", "settings", "health"]);
  });

  it("lights the tab of the hub a screen belongs to, and More for the pages behind it", () => {
    expect(activeItem("admin", "/admin")).toBe("home");
    expect(activeItem("admin", "/en/admin/leads/")).toBe("leads");
    expect(activeItem("admin", "/admin/leads/11111111-1111-4111-8111-111111111111")).toBe("leads");
    expect(activeItem("admin", "/admin/content/universities/new")).toBe("content");
    expect(activeItem("admin", "/admin/insights")).toBe("insights");
    expect(activeItem("admin", "/admin/notifications")).toBe("more");
    expect(activeItem("owner", "/admin/security")).toBe("more");
  });

  it("has a tour for each of the four staff tabs", () => {
    for (const tab of ["home", "leads", "content", "insights"] as const) {
      expect(TOUR_KEYS).toContain(tab);
      for (const catalogue of [en, fr]) {
        const steps = catalogue.admin.tours[tab];
        expect(steps, tab).toHaveLength(3);
        for (const step of steps) {
          expect(step.title.length).toBeGreaterThan(0);
          expect(step.body.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("the old admin addresses (architecture 21.5)", () => {
  it("moves each to the section that took its place, keeping the query", () => {
    expect(legacyTarget("/admin/leads/link-requests", "")).toBe("/admin/leads?view=link-requests");
    expect(legacyTarget("/admin/data-requests", "")).toBe("/admin/leads?view=data-requests");
    expect(legacyTarget("/admin/content/stale", "")).toBe("/admin/content?view=stale");
    expect(legacyTarget("/admin/content/media", "")).toBe("/admin/content?view=media");
    expect(legacyTarget("/admin/analytics", "?tab=sources&from=2026-10-01")).toBe("/admin/insights?tab=sources&from=2026-10-01&view=funnel");
    expect(legacyTarget("/admin/analytics/performance", "")).toBe("/admin/insights?view=performance");
    expect(legacyTarget("/admin/payments", "")).toBe("/admin/insights?view=payments");
  });

  it("leaves every address that was not moved alone", () => {
    for (const path of ["/admin", "/admin/leads", "/admin/leads/11111111-1111-4111-8111-111111111111", "/admin/content", "/admin/content/universities", "/admin/team", "/admin/notifications", "/me", "/"]) {
      expect(legacyTarget(path, ""), path).toBeNull();
    }
  });

  it("is checked by the Worker before anything that needs a session", () => {
    const source = readFileSync("worker/index.ts", "utf8");
    expect(source).toContain("handleLegacyRedirect");
    expect(source.indexOf("handleLegacyRedirect(request)")).toBeLessThan(source.indexOf("handleSignIn(request, env)"));
    expect(source.indexOf("handleLegacyRedirect(request)")).toBeLessThan(source.indexOf("handleAuthed("));
  });
});

describe("the staff shells the phone may keep", () => {
  it("keeps the four tabs, Notifications and Profile, and nothing owner-only or personal", () => {
    for (const path of ["/admin", "/admin/leads", "/admin/content", "/admin/insights", "/admin/notifications", "/admin/profile", "/en/admin"]) expect(isKeptShell(path), path).toBe(true);
    for (const path of ["/admin/team", "/admin/audit", "/admin/security", "/admin/settings", "/admin/health", "/admin/leads/11111111-1111-4111-8111-111111111111", "/admin/payments"]) expect(isKeptShell(path), path).toBe(false);
  });
});

describe("the words", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value !== null && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];

  it("has the same staff strings in English and French", () => {
    expect(keys(fr.admin).sort()).toEqual(keys(en.admin).sort());
  });

  it("has a sentence for every kind of activity the Home can list", () => {
    for (const type of ["created", "note", "stage_changed", "reply_logged", "assigned", "admin_wa_opened", "claimed", "merged", "duplicate_dismissed", "anonymised", "other"]) {
      expect((en.admin.home.activity.types as Record<string, string>)[type], type).toBeTruthy();
    }
  });

  it("gives every page that had no purpose line one", () => {
    for (const catalogue of [en, fr]) {
      expect(catalogue.admin.profile.purpose).toBeTruthy();
      expect(catalogue.admin.security.purpose).toBeTruthy();
      expect(catalogue.admin.team.purpose).toBeTruthy();
      expect(catalogue.admin.home.purpose).toBeTruthy();
    }
  });
});
