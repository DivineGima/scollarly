"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/shell/empty-state";
import { PageIntro } from "@/components/shell/page-intro";
import { formatWat } from "@/lib/time";
import { changeOf, dollarsFromCents, type Period, readPeriod, PERIODS } from "@/modules/dashboard/periods";
import type { HomeActivity, HomeTotals } from "@/server/repositories/admin-home";
import { readDashboardSnapshot, saveDashboardSnapshot } from "@/offline/dashboard-snapshot";
import { useAdminSession } from "./admin-shell";
import { LineChart } from "./charts/line-chart";
import { DataStatus, useAdminData } from "./use-admin-data";
import "./charts/charts.css";

interface HomeData {
  period: Period;
  role: "admin" | "owner";
  days: number;
  series: { label: string; value: number }[];
  totals: HomeTotals;
  activity: HomeActivity[];
}

interface TileSpec {
  key: "newLeads" | "waiting" | "overdue" | "stageMoves" | "payments" | "onboarded";
  value: number;
  previous: number | null;
  /** Shown instead of the number, for money. */
  text?: string;
  href: string;
}

/** Four tiles at most (ADR-046): the admin's working numbers, or the owner's. */
export function tilesOf(data: Pick<HomeData, "role" | "totals">): TileSpec[] {
  const t = data.totals;
  if (data.role === "owner") {
    return [
      { key: "newLeads", value: t.newLeads.value, previous: t.newLeads.previous, href: "/admin/leads" },
      { key: "overdue", value: t.overdue, previous: null, href: "/admin/leads?view=overdue" },
      { key: "payments", value: t.payments?.valueCents ?? 0, previous: t.payments?.previousCents ?? 0, text: dollarsFromCents(t.payments?.valueCents ?? 0), href: "/admin/insights?view=payments" },
      { key: "onboarded", value: t.onboarded?.value ?? 0, previous: t.onboarded?.previous ?? 0, href: "/admin/leads" },
    ];
  }
  return [
    { key: "newLeads", value: t.newLeads.value, previous: t.newLeads.previous, href: "/admin/leads" },
    { key: "waiting", value: t.waiting, previous: null, href: "/admin/leads?view=unanswered" },
    { key: "overdue", value: t.overdue, previous: null, href: "/admin/leads?view=overdue" },
    { key: "stageMoves", value: t.stageMoves.value, previous: t.stageMoves.previous, href: "/admin/insights?view=performance" },
  ];
}

/**
 * The staff Home (architecture 21.9, F18; S13.6): what needs the person today, four numbers that each compare with the period before, one
 * line of new leads per day, and the latest activity. A week or a month. Offline it shows the totals the phone kept, with when they were last
 * known; the list of latest activity (lead references) is never kept on the phone.
 */
export function AdminHome() {
  const t = useTranslations("admin.home");
  const session = useAdminSession();
  const [period, setPeriod] = useState<Period>("week");
  useEffect(() => setPeriod(readPeriod(new URLSearchParams(window.location.search).get("period"))), []);
  const { state, reload } = useAdminData<HomeData>(`/api/v1/admin/home?period=${period}`);
  const [kept, setKept] = useState<{ data: Omit<HomeData, "activity">; updatedAt: number } | null>(null);

  useEffect(() => {
    if (state.status !== "ready") return;
    const { totals, series, role } = state.data;
    if (session.userId) void saveDashboardSnapshot({ userId: session.userId, period, role, totals, series, updatedAt: Date.now() });
    setKept(null);
  }, [state, period, session.userId]);

  useEffect(() => {
    if (state.status !== "error" || state.httpStatus !== 0 || !session.userId) return;
    void readDashboardSnapshot(session.userId, period).then((row) => {
      if (row) setKept({ data: { period, role: row.role as HomeData["role"], days: row.series.length, series: row.series, totals: row.totals as HomeTotals }, updatedAt: row.updatedAt });
    });
  }, [state, period, session.userId]);

  function choose(next: Period) {
    setPeriod(next);
    const url = new URL(window.location.href);
    url.searchParams.set("period", next);
    window.history.replaceState(null, "", url);
  }

  const data: Omit<HomeData, "activity"> & { activity?: HomeActivity[] } | null = state.status === "ready" ? state.data : kept?.data ?? null;

  return (
    <section className="admin-home">
      <PageIntro title={t("title")} purpose={t("purpose")} />
      <p className="admin-home-welcome">{t("welcome", { name: (session.name || session.email).split(/\s+/)[0] ?? "" })}</p>

      <div role="group" aria-label={t("period.label")} className="admin-home-period">
        {PERIODS.map((p) => (
          <button key={p} type="button" aria-pressed={period === p} className="admin-home-period-button" onClick={() => choose(p)}>
            {t(`period.${p}`)}
          </button>
        ))}
      </div>

      {data === null ? <DataStatus state={state} reload={reload} /> : null}
      {kept && state.status !== "ready" ? (
        <p role="status" className="admin-home-offline" data-testid="from-phone">
          {t("offline")} {t("lastUpdated", { date: formatWat(new Date(kept.updatedAt)) })}
        </p>
      ) : null}
      {data ? <Body data={data} period={period} offline={state.status !== "ready"} /> : null}
    </section>
  );
}

function Body({ data, period, offline }: { data: Omit<HomeData, "activity"> & { activity?: HomeActivity[] }; period: Period; offline: boolean }) {
  const t = useTranslations("admin.home");
  const tiles = tilesOf(data);
  const totals = data.totals;
  const needs = [
    totals.overdue > 0 ? { href: "/admin/leads?view=overdue", text: t("needs.overdue", { count: totals.overdue }) } : null,
    totals.waiting > 0 ? { href: "/admin/leads?view=unanswered", text: t("needs.waiting", { count: totals.waiting }) } : null,
    totals.pendingClaims > 0 ? { href: "/admin/leads?view=link-requests", text: t("needs.claims", { count: totals.pendingClaims }) } : null,
    totals.openDataRequests > 0 ? { href: "/admin/leads?view=data-requests", text: t("needs.data", { count: totals.openDataRequests }) } : null,
  ].filter((item): item is { href: string; text: string } => item !== null);

  return (
    <>
      <section aria-labelledby="home-needs" className="admin-home-needs" data-testid="needs-you">
        <h2 id="home-needs">{t("needs.title")}</h2>
        {needs.length === 0 ? (
          <p>{t("needs.nothing")}</p>
        ) : (
          <ul>
            {needs.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.text}</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ul className="admin-home-tiles">
        {tiles.map((tile) => {
          const change = changeOf(tile.value, tile.previous);
          return (
            <li key={tile.key}>
              <a href={offline ? undefined : tile.href} className="admin-home-tile" data-testid={`tile-${tile.key}`}>
                <span className="admin-home-tile-label">{t(`tiles.${tile.key}`)}</span>
                <span className="admin-home-tile-value">{tile.text ?? tile.value}</span>
                <span className="admin-home-tile-change" data-direction={change?.direction ?? "none"}>
                  {change === null ? t("change.now") : change.direction === "same" ? t(`change.same.${period}`) : t(`change.${change.direction}.${period}`, { delta: tile.key === "payments" ? dollarsFromCents(Math.abs(change.delta)) : Math.abs(change.delta) })}
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <LineChart points={data.series} caption={t(`chart.caption.${period}`)} columns={{ label: t("chart.day"), value: t("chart.leads") }} empty={t("chart.empty")} />

      {data.activity ? (
        <section aria-labelledby="home-activity" className="admin-home-activity">
          <h2 id="home-activity">{t("activity.title")}</h2>
          {data.activity.length === 0 ? (
            <EmptyState title={t("activity.emptyTitle")} next={t("activity.emptyNext")} action={{ href: "/admin/leads", label: t("activity.emptyAction") }} />
          ) : (
            <ul>
              {data.activity.map((item) => (
                <li key={`${item.leadId}-${item.at}-${item.type}`}>
                  <a href={`/admin/leads/${item.leadId}`}>{t.has(`activity.types.${item.type}`) ? t(`activity.types.${item.type}`, { ref: item.ref }) : t("activity.types.other", { ref: item.ref })}</a>
                  <time dateTime={item.at}>{formatWat(new Date(item.at))}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
