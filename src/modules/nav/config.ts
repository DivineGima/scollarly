/**
 * The tab bar and the More sheet (architecture 21.10, ADR-041). This file is pure data and pure functions: the only place that lists the
 * tabs. It decides what to show, never what a person may do. Access is decided by the server for every request (the auth facade and
 * row level security), so hiding an owner-only row here is a convenience, not a lock.
 */

export type NavRole = "student" | "admin" | "owner";

export type TabKey = "home" | "universities" | "progress" | "help" | "leads" | "content" | "insights";

export type IconName = TabKey | "more" | "bell" | "profile" | "data" | "team" | "audit" | "security" | "settings" | "health" | "signOut";

export interface NavTab {
  key: TabKey;
  href: string;
  icon: IconName;
}

export interface MoreItem {
  key: "profile" | "data" | "team" | "audit" | "security" | "settings" | "health";
  href: string;
  icon: IconName;
  /** Shown to the owner only (as today: team, audit, security, settings and health are owner pages). */
  ownerOnly?: true;
}

/** Student: Home, Universities, My progress, Help (owner decision, 2026-10-31). */
const STUDENT_TABS: readonly NavTab[] = [
  { key: "home", href: "/me", icon: "home" },
  { key: "universities", href: "/me/universities", icon: "universities" },
  { key: "progress", href: "/me/progress", icon: "progress" },
  { key: "help", href: "/me/help", icon: "help" },
];

/** Admin and owner share the same four tabs: Home, Leads, Content, Insights. */
const STAFF_TABS: readonly NavTab[] = [
  { key: "home", href: "/admin", icon: "home" },
  { key: "leads", href: "/admin/leads", icon: "leads" },
  { key: "content", href: "/admin/content", icon: "content" },
  { key: "insights", href: "/admin/insights", icon: "insights" },
];

const STUDENT_MORE: readonly MoreItem[] = [
  { key: "profile", href: "/me/profile", icon: "profile" },
  { key: "data", href: "/me/data", icon: "data" },
];

const STAFF_MORE: readonly MoreItem[] = [
  { key: "profile", href: "/admin/profile", icon: "profile" },
  { key: "team", href: "/admin/team", icon: "team", ownerOnly: true },
  { key: "audit", href: "/admin/audit", icon: "audit", ownerOnly: true },
  { key: "security", href: "/admin/security", icon: "security", ownerOnly: true },
  { key: "settings", href: "/admin/settings", icon: "settings", ownerOnly: true },
  { key: "health", href: "/admin/health", icon: "health", ownerOnly: true },
];

export const SIGN_OUT_HREF = "/sign-out";

export function tabsFor(role: NavRole): readonly NavTab[] {
  return role === "student" ? STUDENT_TABS : STAFF_TABS;
}

/** The rows of the More sheet under Notifications and above Sign out. An admin never gets an owner-only row. */
export function moreItemsFor(role: NavRole): readonly MoreItem[] {
  const items = role === "student" ? STUDENT_MORE : STAFF_MORE;
  return items.filter((item) => item.ownerOnly !== true || role === "owner");
}

export function notificationsHref(role: NavRole): string {
  return role === "student" ? "/me/notifications" : "/admin/notifications";
}

/** The tour keys the server accepts for `app_mark_tour_seen`: one per tab. */
export const TOUR_KEYS: readonly TabKey[] = ["home", "universities", "progress", "help", "leads", "content", "insights"];

const LOCALE_PREFIX = /^\/en(?=\/|$)/;

/** `/en/admin/leads/` becomes `/admin/leads`. */
export function normalisePath(pathname: string): string {
  const stripped = pathname.replace(LOCALE_PREFIX, "").replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

const within = (path: string, href: string): boolean => path === href || path.startsWith(`${href}/`);

/**
 * Which part of the bar is lit for a path: a tab, the round More button (Notifications and every page behind it), or nothing.
 * A screen inside a tab (one lead, one content record) keeps its tab lit.
 */
export function activeItem(role: NavRole, pathname: string): TabKey | "more" | null {
  const path = normalisePath(pathname);
  for (const tab of tabsFor(role)) {
    // The first tab is the area's own address, so it is lit only by itself.
    const isHome = tab.key === "home";
    if (isHome ? path === tab.href : within(path, tab.href)) return tab.key;
  }
  const behindMore = [notificationsHref(role), ...moreItemsFor(role).map((item) => item.href)];
  if (behindMore.some((href) => within(path, href))) return "more";
  return null;
}
