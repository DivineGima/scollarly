"use client";


import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/shell/empty-state";
import { PageIntro } from "@/components/shell/page-intro";
import { api } from "@/lib/client/api";
import { formatWat, startOfWatDay, watDateString } from "@/lib/time";
import { type NotificationItem, WAITING_DAYS } from "@/modules/notifications/items";
import { NOTIFICATIONS_CHANGED_EVENT } from "./events";
import "@/components/shell/shell.css";
import "./notifications.css";

type Area = "me" | "admin";

interface ListData {
  items: NotificationItem[];
  unread: number;
}

type State = { status: "loading" } | { status: "ready"; data: ListData } | { status: "error"; offline: boolean };

/** Where an item leads: one action each (architecture 21.8). Staff addresses are the pages that exist today; the hubs (S13.6) redirect from them. */
function actionOf(item: NotificationItem): { href: string; label: "openProgress" | "viewUniversity" | "continue" | "openLead" | "openRequests" | "openPayments" | "openStale" | "openHealth" } {
  switch (item.kind) {
    case "stage_changed":
    case "reply_logged":
      return { href: "/me/progress", label: "openProgress" };
    case "new_match":
      return { href: `/universities/${item.slug ?? ""}`, label: "viewUniversity" };
    case "finish_onboarding":
      return { href: "/me/onboarding", label: "continue" };
    case "new_lead":
    case "sla_due":
    case "lead_waiting":
      return { href: `/admin/leads/${item.leadId ?? ""}`, label: "openLead" };
    case "link_requests":
      return { href: "/admin/leads/link-requests", label: "openRequests" };
    case "data_requests":
      return { href: "/admin/data-requests", label: "openRequests" };
    case "payment":
      return { href: "/admin/payments", label: "openPayments" };
    case "stale_content":
      return { href: "/admin/content/stale", label: "openStale" };
    case "storage":
      return { href: "/admin/health", label: "openHealth" };
  }
}

const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * The Notifications page for the student and for staff (architecture 21.8, ADR-045): what needs the person, newest first, grouped Today and
 * Earlier, each with one action. "Mark all read" moves only their own last-seen time. Nothing is pushed or emailed.
 */
export function NotificationsPanel({ area }: { area: Area }) {
  const t = useTranslations("notifications");
  const [state, setState] = useState<State>({ status: "loading" });
  const [marking, setMarking] = useState(false);
  const [now] = useState(() => new Date());

  const load = useCallback(async () => {
    const result = await api<ListData>("GET", `/api/v1/${area}/notifications`);
    if (result.ok) setState({ status: "ready", data: result.data });
    else {
      if (result.status === 401) window.location.replace("/sign-in");
      setState({ status: "error", offline: result.status === 0 });
    }
  }, [area]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAll() {
    setMarking(true);
    const result = await api<{ seen: boolean }>("POST", `/api/v1/${area}/notifications.seen`, {});
    setMarking(false);
    if (result.ok) {
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      await load();
    }
  }

  return (
    <div className="notif">
      <PageIntro title={t("title")} purpose={t(area === "me" ? "purposeStudent" : "purposeStaff")} />
      {state.status === "loading" ? <p role="status">{t("loading")}</p> : null}
      {state.status === "error" ? (
        <div role="alert" className="notif-error">
          <p>{state.offline ? t("offline") : t("error")}</p>
          <button type="button" className="notif-button" onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        state.data.items.length === 0 ? (
          <EmptyState title={t("empty.title")} next={t(area === "me" ? "empty.nextStudent" : "empty.nextStaff")} />
        ) : (
          <>
            <div className="notif-bar">
              <p className="notif-count" role="status">
                {t("unread", { count: state.data.unread })}
              </p>
              <button type="button" className="notif-button" onClick={() => void markAll()} disabled={marking || state.data.unread === 0}>
                {t("markAll")}
              </button>
            </div>
            <Groups items={state.data.items} now={now} />
          </>
        )
      ) : null}
    </div>
  );
}

function Groups({ items, now }: { items: readonly NotificationItem[]; now: Date }) {
  const t = useTranslations("notifications");
  const todayStart = startOfWatDay(now).getTime();
  const today = items.filter((item) => new Date(item.at).getTime() >= todayStart);
  const earlier = items.filter((item) => new Date(item.at).getTime() < todayStart);
  return (
    <>
      {today.length > 0 ? (
        <section aria-labelledby="notif-today">
          <h2 id="notif-today">{t("today")}</h2>
          <List items={today} />
        </section>
      ) : null}
      {earlier.length > 0 ? (
        <section aria-labelledby="notif-earlier">
          <h2 id="notif-earlier">{t("earlier")}</h2>
          <List items={earlier} />
        </section>
      ) : null}
    </>
  );
}

function List({ items }: { items: readonly NotificationItem[] }) {
  return (
    <ul className="notif-list">
      {items.map((item) => (
        <Row key={item.id} item={item} />
      ))}
    </ul>
  );
}

function Row({ item }: { item: NotificationItem }) {
  const t = useTranslations("notifications");
  const stages = useTranslations("me.stages");
  const action = actionOf(item);
  const at = new Date(item.at);
  const stage = item.stage && stages.has(item.stage) ? stages(item.stage) : (item.stage ?? "");
  const lead = item.name ? `${item.name} (${item.ref})` : (item.ref ?? "");
  const text = (() => {
    switch (item.kind) {
      case "stage_changed":
        return t("items.stage_changed", { stage });
      case "reply_logged":
        return t("items.reply_logged");
      case "new_match":
        return t("items.new_match", { university: item.university ?? "" });
      case "finish_onboarding":
        return t("items.finish_onboarding");
      case "new_lead":
        return t("items.new_lead", { lead });
      case "sla_due":
        return t(item.overdue ? "items.sla_overdue" : "items.sla_soon", { lead });
      case "lead_waiting":
        return t("items.lead_waiting", { lead, days: WAITING_DAYS });
      case "link_requests":
        return t("items.link_requests", { count: item.count ?? 0 });
      case "data_requests":
        return t("items.data_requests", { count: item.count ?? 0 });
      case "payment":
        return t("items.payment", { amount: dollars(item.amountUsdCents ?? 0), university: item.university ?? "" });
      case "stale_content":
        return t("items.stale_content", { count: item.count ?? 0 });
      case "storage":
        return t(`items.storage_${item.storage}_${item.level}`);
    }
  })();
  return (
    <li className="notif-item" data-unread={item.unread ? "true" : undefined} data-kind={item.kind}>
      <p className="notif-text">
        {item.unread ? (
          <>
            <span className="notif-dot" aria-hidden="true" />
            <span className="sr-only">{t("new")} </span>
          </>
        ) : null}
        {text}
      </p>
      <p className="notif-meta">
        <time dateTime={item.at}>{watDateString(at) === watDateString(new Date()) ? formatWat(at).slice(11) : formatWat(at)}</time>
        <a className="notif-action" href={action.href}>
          {t(`actions.${action.label}`)}
        </a>
      </p>
    </li>
  );
}
