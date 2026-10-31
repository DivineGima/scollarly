"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { STUDENT_COUNTRIES } from "@/lib/constants";
import { DAY_MS, watDateString } from "@/lib/time";
import { formatUsd } from "@/modules/payments/service";
import { useAdminSession } from "./admin-shell";
import { Button } from "./ui/button";
import { cn } from "./ui/cn";
import { Input, Label } from "./ui/input";
import { DataStatus } from "./use-admin-data";

type Tab = "funnel" | "sources" | "performance";
const TABS: readonly Tab[] = ["funnel", "sources", "performance"];

interface Filters {
  tab: Tab;
  from: string;
  to: string;
  country: string;
  university: string;
}

interface FunnelRow {
  key: string;
  count: number;
  ratio: number | null;
  stage: string | null;
  label: string | null;
}

interface AnalyticsData {
  range: { from: string; to: string };
  collectPageViews: boolean;
  funnel: FunnelRow[];
  sources: {
    byCountry: { country: string; leads: number }[];
    byUniversity: { universityId: string | null; name: string | null; leads: number }[];
    byPage: { page: string | null; leads: number }[];
  };
  universities: { id: string; name: string }[];
  /** S9.3: payments received in the range, voided ones left out. */
  payments: { totalCents: number; count: number; byUniversity: { universityId: string; name: string; totalCents: number; count: number }[] };
  totalLeads: number;
}

interface PerformanceData {
  range: { from: string; to: string };
  assigned: number;
  answered: number;
  medianMinutes: number | null;
  meanMinutes: number | null;
  overdue: number;
}

const today = () => watDateString(new Date());
const daysAgo = (days: number) => watDateString(new Date(Date.now() - (days - 1) * DAY_MS));

/** The default view: the last 30 days (WAT), every country and university. */
export function defaultFilters(): Filters {
  return { tab: "funnel", from: daysAgo(30), to: today(), country: "", university: "" };
}

/** The filters live in the URL (B10 step 2), so a view can be bookmarked and the browser's Back button works. */
export function filtersFromSearch(search: string): Filters {
  const params = new URLSearchParams(search);
  const base = defaultFilters();
  // `view` is the hub's name for it (an old bookmark of the Insights hub, S13.6); `tab` is what the panel itself writes.
  const tab = params.get("tab") ?? params.get("view");
  return {
    tab: (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : base.tab,
    from: params.get("from") ?? base.from,
    to: params.get("to") ?? base.to,
    country: params.get("country") ?? "",
    university: params.get("university") ?? "",
  };
}

export function searchFromFilters(filters: Filters): string {
  const params = new URLSearchParams({ tab: filters.tab, from: filters.from, to: filters.to });
  if (filters.country) params.set("country", filters.country);
  if (filters.university) params.set("university", filters.university);
  return `?${params}`;
}

function dataPath(filters: Filters): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.tab !== "performance") {
    if (filters.country) params.set("country", filters.country);
    if (filters.university) params.set("university", filters.university);
  }
  return `/api/v1/admin/${filters.tab === "performance" ? "performance" : "analytics"}?${params}`;
}

/** The leads behind a bar (B10 step 3). The leads list has no date range, so the link carries the stage, the country and the university. */
function leadsLink(row: FunnelRow, filters: Filters): string | null {
  if (row.key === "visit" || row.key === "wa_tap") return null;
  const params = new URLSearchParams();
  if (row.stage) params.set("stage", row.stage);
  if (filters.country) params.set("country", filters.country);
  if (filters.university) params.set("university", filters.university);
  const text = params.toString();
  return `/admin/leads${text ? `?${text}` : ""}`;
}

/** B10: the funnel, the sources, and the signed-in admin's own numbers. */
export function AnalyticsPanel() {
  const t = useTranslations("admin.analytics");
  const id = useId();
  const [applied, setApplied] = useState<Filters | null>(null);
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [data, setData] = useState<AnalyticsData | PerformanceData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "filters">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const read = () => {
      const filters = filtersFromSearch(window.location.search);
      setApplied(filters);
      setDraft(filters);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const load = useCallback(async (filters: Filters) => {
    const mine = ++latest.current;
    setState("loading");
    setProblem(null);
    const result = await api<AnalyticsData | PerformanceData>("GET", dataPath(filters));
    if (mine !== latest.current) return;
    if (result.ok) {
      setData(result.data);
      setState("ready");
    } else if (result.status === 401) window.location.replace("/sign-in");
    else if (result.code === "VALIDATION") {
      setProblem(result.fields.from ?? result.fields.to ?? "INVALID");
      setState("filters");
    } else setState("error");
  }, []);

  useEffect(() => {
    if (applied) void load(applied);
  }, [applied, load]);

  function apply(next: Filters) {
    window.history.pushState(null, "", `${window.location.pathname}${searchFromFilters(next)}`);
    setApplied(next);
    setDraft(next);
  }

  if (!applied) return null;
  const analytics = state === "ready" && applied.tab !== "performance" ? (data as AnalyticsData) : null;
  const performance = state === "ready" && applied.tab === "performance" ? (data as PerformanceData) : null;

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>

      <nav aria-label={t("tabs.label")} className="mt-4">
        <ul className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <li key={tab}>
              <button
                type="button"
                aria-current={applied.tab === tab ? "page" : undefined}
                onClick={() => apply({ ...applied, tab })}
                className={cn("inline-flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-surface", applied.tab === tab && "bg-surface")}
              >
                {t(`tabs.${tab}`)}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <form
        className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <div>
          <Label htmlFor={`${id}-from`}>{t("filters.from")}</Label>
          <Input id={`${id}-from`} type="date" max={today()} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${id}-to`}>{t("filters.to")}</Label>
          <Input id={`${id}-to`} type="date" max={today()} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </div>
        {applied.tab !== "performance" ? (
          <>
            <div>
              <Label htmlFor={`${id}-country`}>{t("filters.country")}</Label>
              <select id={`${id}-country`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}>
                <option value="">{t("filters.any")}</option>
                {STUDENT_COUNTRIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`${id}-university`}>{t("filters.university")}</Label>
              <select id={`${id}-university`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.university} onChange={(event) => setDraft({ ...draft, university: event.target.value })}>
                <option value="">{t("filters.any")}</option>
                {(analytics?.universities ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">{t("filters.apply")}</Button>
          {[30, 90, 365].map((days) => (
            <Button key={days} variant="outline" onClick={() => apply({ ...applied, from: daysAgo(days), to: today() })}>
              {t("filters.lastDays", { days })}
            </Button>
          ))}
        </div>
      </form>

      <div className="mt-6" aria-live="polite">
        {state === "filters" ? (
          <p role="alert" className="text-danger">
            {t(`problems.${problem ?? "INVALID"}` as "problems.INVALID")}
          </p>
        ) : (
          <DataStatus state={state === "error" ? { status: "error", httpStatus: 500 } : state === "loading" ? { status: "loading" } : { status: "ready", data: null }} reload={() => void load(applied)} />
        )}
      </div>

      {analytics && applied.tab === "funnel" ? <Funnel data={analytics} filters={applied} /> : null}
      {analytics && applied.tab === "sources" ? <Sources data={analytics} /> : null}
      {analytics ? <PaymentsReceived data={analytics} filters={applied} /> : null}
      {performance ? <Performance data={performance} /> : null}

      {state === "ready" ? (
        <p className="mt-8 text-sm text-fg-muted" data-testid="limits-notice">
          {t("limits")}
        </p>
      ) : null}
    </section>
  );
}

function percent(ratio: number | null): string | null {
  return ratio === null ? null : `${Math.round(ratio * 100)}%`;
}

function Funnel({ data, filters }: { data: AnalyticsData; filters: Filters }) {
  const t = useTranslations("admin.analytics");
  const max = Math.max(...data.funnel.map((r) => r.count), 1);
  return (
    <div>
      <p className="text-fg-muted">{t("funnel.range", { from: data.range.from, to: data.range.to })}</p>
      {!data.collectPageViews ? (
        <p role="status" className="mt-3 rounded-md border border-warning p-3 text-warning" data-testid="kill-switch-notice">
          {t("funnel.visitsOff")}
        </p>
      ) : null}
      {data.totalLeads === 0 && data.funnel.every((r) => r.count === 0) ? (
        <p className="mt-4">{t("funnel.empty")}</p>
      ) : (
        <ol className="mt-4 space-y-2" data-testid="funnel">
          {data.funnel.map((row) => {
            const href = leadsLink(row, filters);
            const label = row.label ?? t(`funnel.steps.${row.key}` as "funnel.steps.lead");
            const body = (
              <>
                <span className="flex flex-wrap justify-between gap-x-4">
                  <span>{label}</span>
                  <span className="font-semibold" data-testid={`funnel-${row.key}`}>
                    {row.count}
                    {percent(row.ratio) ? <span className="ml-2 font-normal text-fg-muted">{t("funnel.ofPrevious", { percent: percent(row.ratio) ?? "" })}</span> : null}
                  </span>
                </span>
                <span className="mt-1 block h-2 rounded-full bg-surface" aria-hidden="true">
                  <span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.round((row.count / max) * 100)}%` }} />
                </span>
              </>
            );
            return (
              <li key={row.key}>
                {href ? (
                  <a href={href} className="block rounded-md p-2 hover:bg-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    {body}
                  </a>
                ) : (
                  <div className="p-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function BarList({ title, rows }: { title: string; rows: { key: string; label: string; leads: number }[] }) {
  const t = useTranslations("admin.analytics");
  const max = Math.max(...rows.map((r) => r.leads), 1);
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-fg-muted">{t("sources.none")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.key}>
              <span className="flex justify-between gap-4">
                <span className="break-words">{row.label}</span>
                <span className="font-semibold">{row.leads}</span>
              </span>
              <span className="mt-1 block h-2 rounded-full bg-surface" aria-hidden="true">
                <span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.round((row.leads / max) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** B10 step 4: leads by country, by university and by the page they came from. */
function Sources({ data }: { data: AnalyticsData }) {
  const t = useTranslations("admin.analytics.sources");
  return (
    <div className="grid gap-8 lg:grid-cols-3" data-testid="sources">
      <BarList title={t("country")} rows={data.sources.byCountry.map((r) => ({ key: r.country, label: r.country, leads: r.leads }))} />
      <BarList title={t("university")} rows={data.sources.byUniversity.map((r) => ({ key: r.universityId ?? "none", label: r.name ?? t("noUniversity"), leads: r.leads }))} />
      <BarList title={t("page")} rows={data.sources.byPage.map((r) => ({ key: r.page ?? "none", label: r.page ?? t("noPage"), leads: r.leads }))} />
    </div>
  );
}

export function duration(t: ReturnType<typeof useTranslations>, minutes: number | null): string {
  if (minutes === null) return t("performance.noData");
  if (minutes < 60) return t("performance.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t("performance.hours", { count: hours }) : t("performance.hoursMinutes", { hours, minutes: rest });
}

/** S9.3: what universities paid in the range. The country filter does not apply to it (a payment has no country), and the note says so. */
function PaymentsReceived({ data: all, filters }: { data: AnalyticsData; filters: Filters }) {
  const t = useTranslations("admin.analytics");
  // An older answer (a cached shell talking to an older Worker during a deploy) has no payments block: show zero, never crash the page.
  const data = { ...all, payments: all.payments ?? { totalCents: 0, count: 0, byUniversity: [] } };
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.university) params.set("university", filters.university);
  return (
    <section className="mt-8 rounded-lg border border-border p-4" aria-labelledby="payments-received" data-testid="payments-received">
      <h2 id="payments-received" className="text-lg font-semibold">
        {t("payments.title")}
      </h2>
      <p className="mt-1 text-3xl font-semibold" data-testid="payments-total">
        {t("payments.total", { amount: formatUsd(data.payments.totalCents) })}
      </p>
      <p className="text-sm text-fg-muted">{t("payments.count", { count: data.payments.count })}</p>
      {data.payments.byUniversity.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {data.payments.byUniversity.map((row) => (
            <li key={row.universityId} className="flex justify-between gap-4">
              <span>{row.name}</span>
              <span className="whitespace-nowrap">{t("payments.total", { amount: formatUsd(row.totalCents) })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-fg-muted">{t("payments.none")}</p>
      )}
      <p className="mt-3 text-sm text-fg-muted">{filters.country ? t("payments.countryNote") : t("payments.note")}</p>
      <p className="mt-2">
        <a href={`/admin/payments?${params}`} className="underline">
          {t("payments.open")}
        </a>
      </p>
    </section>
  );
}

/** B10 step 5: the admin's own leads, how fast they were first answered (from logged replies), and what is overdue. */
function Performance({ data }: { data: PerformanceData }) {
  const t = useTranslations("admin.analytics");
  const session = useAdminSession();
  const tiles: { key: string; value: string }[] = [
    { key: "assigned", value: String(data.assigned) },
    { key: "answered", value: String(data.answered) },
    { key: "median", value: duration(t, data.medianMinutes) },
    { key: "mean", value: duration(t, data.meanMinutes) },
    { key: "overdue", value: String(data.overdue) },
  ];
  return (
    <div>
      <p className="text-fg-muted">{t("performance.range", { from: data.range.from, to: data.range.to })}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="performance">
        {tiles.map((tile) => (
          <li key={tile.key} className="rounded-lg border border-border p-4">
            <span className="block text-3xl font-semibold" data-testid={`perf-${tile.key}`}>
              {tile.value}
            </span>
            <span className="mt-1 block text-fg-muted">{t(`performance.tiles.${tile.key}` as "performance.tiles.assigned")}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-fg-muted">{t("performance.basis")}</p>
      {session.role === "owner" ? (
        <p className="mt-2">
          <a href="/admin/analytics/performance" className="underline">
            {t("performance.seeAll")}
          </a>
        </p>
      ) : null}
      {data.overdue > 0 ? (
        <p className="mt-2">
          <a href="/admin/leads?view=overdue&assigned=me" className="underline">
            {t("performance.seeOverdue")}
          </a>
        </p>
      ) : null}
    </div>
  );
}
