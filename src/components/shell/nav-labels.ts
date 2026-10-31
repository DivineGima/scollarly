import type { AppNavLabels } from "./app-nav";

type Translate = {
  (key: string, values?: Record<string, string | number>): string;
};

/** The labels of the bar and the More sheet, from the `shell` messages. One place, so the student and the staff areas say the same thing. */
export function navLabels(t: Translate, area: "student" | "staff"): AppNavLabels {
  return {
    nav: t(area === "student" ? "navStudent" : "navStaff"),
    tabs: {
      home: t("tabs.home"),
      universities: t("tabs.universities"),
      progress: t("tabs.progress"),
      help: t("tabs.help"),
      leads: t("tabs.leads"),
      content: t("tabs.content"),
      insights: t("tabs.insights"),
    },
    more: t("more"),
    sheet: {
      title: t("sheet.title"),
      close: t("sheet.close"),
      notifications: t("sheet.notifications"),
      unreadCount: (count) => t("sheet.unreadCount", { count }),
      items: {
        profile: t("sheet.items.profile"),
        data: t("sheet.items.data"),
        team: t("sheet.items.team"),
        audit: t("sheet.items.audit"),
        security: t("sheet.items.security"),
        settings: t("sheet.items.settings"),
        health: t("sheet.items.health"),
      },
      signOut: t("sheet.signOut"),
    },
  };
}
