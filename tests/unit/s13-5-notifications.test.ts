import { describe, expect, it } from "vitest";
import { isUnread, MAX_ITEMS, newestFirst, slaAlert, SLA_SOON_MINUTES, standingAt, storageAlert, unreadCount, WAITING_DAYS, type NotificationItem } from "@/modules/notifications/items";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S13.5 (architecture 21.8, ADR-045): the rules of the derived notifications. What each person sees, and that "Mark all read" moves only their own
 * time, is tested against a real database in tests/integration/s13-5-notifications.test.ts.
 */

const at = (iso: string) => new Date(iso);
const item = (id: string, when: string, over: Partial<NotificationItem> = {}): NotificationItem => ({ id, kind: "new_lead", at: when, unread: true, ...over });

describe("unread (21.8)", () => {
  const seen = at("2026-11-01T10:00:00Z");

  it("is newer than the last time the person marked everything read", () => {
    expect(isUnread(at("2026-11-01T10:00:01Z"), seen)).toBe(true);
    expect(isUnread(at("2026-11-01T10:00:00Z"), seen)).toBe(false);
    expect(isUnread(at("2026-10-31T10:00:00Z"), seen)).toBe(false);
  });

  it("makes everything unread for someone who has never marked anything read", () => {
    expect(isUnread(at("2020-01-01T00:00:00Z"), null)).toBe(true);
  });

  it("counts only the unread items", () => {
    expect(unreadCount([item("a", "2026-11-02T00:00:00Z"), item("b", "2026-11-02T00:00:00Z", { unread: false })])).toBe(1);
    expect(unreadCount([])).toBe(0);
  });
});

describe("the list", () => {
  it("is newest first, with a stable order for the same moment", () => {
    const list = newestFirst([item("b", "2026-11-01T00:00:00Z"), item("c", "2026-11-03T00:00:00Z"), item("a", "2026-11-03T00:00:00Z")]);
    expect(list.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("keeps at most 50, and the newest 50", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`n${i}`, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()));
    const list = newestFirst(many);
    expect(list).toHaveLength(MAX_ITEMS);
    expect(MAX_ITEMS).toBe(50);
    expect(list[0]?.id).toBe("n59");
    expect(list.at(-1)?.id).toBe("n10");
  });

  it("does not change the list it was given", () => {
    const input = [item("a", "2026-11-01T00:00:00Z"), item("b", "2026-11-02T00:00:00Z")];
    newestFirst(input);
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("due soon and overdue (boundary: 60 minutes)", () => {
  const now = at("2026-11-02T12:00:00Z");
  const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

  it("is due within the next 60 minutes, not before", () => {
    expect(SLA_SOON_MINUTES).toBe(60);
    expect(slaAlert(minutes(60), now)).toEqual({ due: true, overdue: false });
    expect(slaAlert(minutes(61), now)).toEqual({ due: false, overdue: false });
    expect(slaAlert(minutes(1), now)).toEqual({ due: true, overdue: false });
  });

  it("is overdue from the moment the target passes", () => {
    expect(slaAlert(minutes(0), now)).toEqual({ due: true, overdue: true });
    expect(slaAlert(minutes(-90), now)).toEqual({ due: true, overdue: true });
  });

  it("waits three days before a lead is 'waiting too long'", () => {
    expect(WAITING_DAYS).toBe(3);
  });
});

describe("a standing condition is dated today, in West Africa Time", () => {
  it("starts the day at 00:00 WAT, which is 23:00 UTC the evening before", () => {
    expect(standingAt(at("2026-11-02T15:30:00Z")).toISOString()).toBe("2026-11-01T23:00:00.000Z");
    // 23:30 UTC is already the next day in WAT.
    expect(standingAt(at("2026-11-02T23:30:00Z")).toISOString()).toBe("2026-11-02T23:00:00.000Z");
  });

  it("is unread again the next day after 'Mark all read', and read the same day", () => {
    const seenToday = at("2026-11-02T15:00:00Z");
    expect(isUnread(standingAt(at("2026-11-02T16:00:00Z")), seenToday)).toBe(false);
    expect(isUnread(standingAt(at("2026-11-03T08:00:00Z")), seenToday)).toBe(true);
  });
});

describe("the two stores", () => {
  const MB = 1024 * 1024;
  it("warns from 70% and calls it urgent from 90%, as the Health banner does", () => {
    expect(storageAlert(69 * MB, 100 * MB)).toBeNull();
    expect(storageAlert(70 * MB, 100 * MB)).toBe("warn");
    expect(storageAlert(89 * MB, 100 * MB)).toBe("warn");
    expect(storageAlert(90 * MB, 100 * MB)).toBe("urgent");
    expect(storageAlert(0, 100 * MB)).toBeNull();
  });
});

describe("the words", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value !== null && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];

  it("has the same notification strings in English and French", () => {
    expect(keys(fr.notifications).sort()).toEqual(keys(en.notifications).sort());
  });

  it("has a sentence for every kind of item, and an action for every kind of link", () => {
    for (const kind of ["stage_changed", "reply_logged", "new_match", "finish_onboarding", "new_lead", "sla_soon", "sla_overdue", "lead_waiting", "link_requests", "data_requests", "payment", "stale_content", "storage_database_warn", "storage_database_urgent", "storage_images_warn", "storage_images_urgent"]) {
      expect((en.notifications.items as Record<string, string>)[kind], kind).toBeTruthy();
    }
    for (const action of ["openProgress", "viewUniversity", "continue", "openLead", "openRequests", "openPayments", "openStale", "openHealth"]) {
      expect((en.notifications.actions as Record<string, string>)[action], action).toBeTruthy();
    }
  });

  it("is linked from the admin menu of today, and from the student's More sheet", () => {
    expect(en.admin.nav.notifications).toBe("Notifications");
    expect(en.shell.sheet.notifications).toBe("Notifications");
  });
});
