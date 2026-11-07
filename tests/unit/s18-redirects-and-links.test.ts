import { describe, expect, it } from "vitest";
import { moreItemsFor, tabsFor } from "@/modules/nav/config";
import { legacyTarget } from "@/server/edge/legacy-redirects";

/**
 * S18.2 (architecture 24.9, 21.5): the redirect table. An old admin address answers 301 to the hub section that took its place, keeping the
 * language prefix and the query. The `phase0` pages are only unlinked (flag F44): no navigation entry points to them and they are not redirected.
 */

const TABLE: [string, string][] = [
  ["/admin/leads/link-requests", "/admin/leads?view=link-requests"],
  ["/admin/data-requests", "/admin/leads?view=data-requests"],
  ["/admin/content/stale", "/admin/content?view=stale"],
  ["/admin/content/media", "/admin/content?view=media"],
  ["/admin/analytics", "/admin/insights?view=funnel"],
  ["/admin/analytics/performance", "/admin/insights?view=performance"],
  ["/admin/payments", "/admin/insights?view=payments"],
];

describe("the redirect table", () => {
  it.each(TABLE)("%s moves to %s", (from, to) => {
    expect(legacyTarget(from, "")).toBe(to);
  });

  it("keeps the language prefix, the query and a trailing slash out of the way", () => {
    expect(legacyTarget("/en/admin/payments/", "?period=month")).toBe("/en/admin/insights?period=month&view=payments");
    expect(legacyTarget("/admin/analytics/", "")).toBe("/admin/insights?view=funnel");
  });

  it("leaves the screens that still exist alone: the Inbox, one student, notifications, the developer probes", () => {
    for (const path of ["/admin", "/admin/leads", "/admin/leads/0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "/admin/notifications", "/admin/team", "/admin/profile", "/admin/phase0", "/me/phase0"]) {
      expect(legacyTarget(path, "")).toBeNull();
    }
  });

  it("sends every target to one of the three hubs the staff bar has", () => {
    const hubs = new Set(tabsFor("admin").map((tab) => tab.href));
    for (const [, to] of TABLE) expect(hubs.has(to.split("?")[0] as string)).toBe(true);
  });
});

describe("the developer probes (flag F44)", () => {
  it("are in no tab and in no More row, for any role", () => {
    for (const role of ["student", "manager", "admin"] as const) {
      const links = [...tabsFor(role), ...moreItemsFor(role)].map((item) => item.href);
      expect(links.filter((href) => href.includes("phase0"))).toEqual([]);
    }
  });
});
