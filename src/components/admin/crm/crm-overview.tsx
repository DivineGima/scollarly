"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { PageIntro } from "@/components/shell/page-intro";
import { changeOf } from "@/modules/dashboard/periods";
import type { Slice } from "@/modules/crm/metrics";
import { BarChart } from "../charts/bar-chart";
import { DonutChart } from "../charts/donut-chart";
import { LineChart } from "../charts/line-chart";
import { DataStatus, useAdminData } from "../use-admin-data";
import "../charts/charts.css";
import { CrmFilters, filterQuery, readAppliedFilters, type AppliedFilters } from "./crm-filters";

interface CrmData {
  range: { from: string; to: string };
  totals: {
    leads: number;
    previousLeads: number;
    answered: number;
    previousAnswered: number;
    answeredPercent: number | null;
    avgFirstResponse: { unit: "minutes" | "hours" | "days"; value: number } | null;
    overdue: number;
    arrived: number;
    arrivedPercent: number | null;
  };
  series: { label: string; value: number }[];
  stages: { code: string; label: string; count: number }[];
  funnel: { code: string; label: string; reached: number; ofAll: number | null; ofPrevious: number | null }[];
  countries: Slice[];
  sources: Slice[];
  admins: { userId: string; name: string; assigned: number; answered: number; overdue: number; medianMinutes: number | null }[] | null;
}

/**
 * The CRM overview (PRD_3 F18 amended, ADR-057): numbers first (each compared with the period before), then the charts, one sentence under each.
 * The filters are in the address; the export link carries the same ones. All numbers are counts and times: no name, number or email is on this
 * screen. Times are WAT days.
 */
export function CrmOverview() {
  const t = useTranslations("admin.crm");
  const [applied, setApplied] = useState<AppliedFilters | null>(null);
  useEffect(() => setApplied(readAppliedFilters(window.location.search)), []);
  const query = applied ? filterQuery(applied) : null;
  const { state, reload } = useAdminData<CrmData>(query === null ? null : `/api/v1/admin/crm${query}`);

  return (
    <section className="crm" aria-labelledby="crm-title">
      <PageIntro title={t("title")} purpose={t("purpose")} />
      {applied ? <CrmFilters view="overview" applied={applied} sources={state.status === "ready" ? state.data.sources.map((s) => s.key) : []} /> : null}
      {state.status !== "ready" ? <DataStatus state={state} reload={reload} /> : null}
      {state.status === "ready" && applied ? <Body data={state.data} applied={applied} /> : null}
    </section>
  );
}

function Tile({ label, value, change, testid }: { label: string; value: string; change?: string | null; testid: string }) {
  return (
    <li className="admin-home-tile" data-testid={testid}>
      <span className="admin-home-tile-label">{label}</span>
      <span className="admin-home-tile-value">{value}</span>
      {change ? <span className="admin-home-tile-change">{change}</span> : null}
    </li>
  );
}

function Body({ data, applied }: { data: CrmData; applied: AppliedFilters }) {
  const t = useTranslations("admin.crm");
  const totals = data.totals;
  const change = (value: number, previous: number): string | null => {
    const c = changeOf(value, previous);
    if (!c) return null;
    if (c.direction === "same") return t("change.same");
    return c.percent === null ? t("change.noBase", { delta: c.delta > 0 ? `+${c.delta}` : String(c.delta) }) : t(c.direction === "up" ? "change.up" : "change.down", { percent: Math.abs(c.percent) });
  };
  const response = totals.avgFirstResponse ? t(`response.${totals.avgFirstResponse.unit}`, { value: totals.avgFirstResponse.value }) : t("response.none");
  const columns = { label: t("columns.name"), value: t("columns.count") };
  const countryNames = (() => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      return null;
    }
  })();
  const countryLabel = (key: string) => (key === "other" ? t("other") : (countryNames?.of(key) ?? key));
  const sourceLabel = (key: string) => (key === "other" ? t("other") : key === "unknown" ? t("unknownSource") : key);

  return (
    <>
      <p className="crm-explain" data-testid="crm-range">
        {t("range", { from: data.range.from, to: data.range.to })}
      </p>
      <ul className="admin-home-tiles" data-testid="crm-tiles">
        <Tile testid="tile-leads" label={t("tiles.leads")} value={String(totals.leads)} change={change(totals.leads, totals.previousLeads)} />
        <Tile testid="tile-answered" label={t("tiles.answered")} value={totals.answeredPercent === null ? "–" : `${totals.answeredPercent}%`} change={t("tiles.answeredOf", { answered: totals.answered, leads: totals.leads })} />
        <Tile testid="tile-response" label={t("tiles.response")} value={response} />
        <Tile testid="tile-overdue" label={t("tiles.overdue")} value={String(totals.overdue)} change={t("tiles.overdueNote")} />
        <Tile testid="tile-arrived" label={t("tiles.arrived")} value={totals.arrivedPercent === null ? "–" : `${totals.arrivedPercent}%`} change={t("tiles.arrivedOf", { arrived: totals.arrived, leads: totals.leads })} />
      </ul>

      <p>
        <a className="crm-export" data-testid="crm-export" href={`/api/v1/admin/export${filterQuery(applied, ["from", "to", "country", "source", "assigned"])}`} download>
          {t("export")}
        </a>
      </p>
      <p className="crm-explain">{t("exportNote")}</p>

      <div className="crm-grid">
        <div className="crm-card">
          <h2>{t("charts.perDay")}</h2>
          <p className="crm-explain">{t("charts.perDayExplain")}</p>
          <LineChart points={data.series} caption={t("charts.perDayCaption")} columns={{ label: t("columns.day"), value: t("columns.count") }} empty={t("empty")} />
        </div>
        <div className="crm-card">
          <h2>{t("charts.stages")}</h2>
          <p className="crm-explain">{t("charts.stagesExplain")}</p>
          <DonutChart id="crm-stages" rows={data.stages.filter((s) => s.count > 0).map((s) => ({ key: s.code, label: s.label, value: s.count }))} caption={t("charts.stagesCaption")} totalLabel={t("charts.totalLabel")} columns={{ label: t("columns.stage"), value: t("columns.count") }} empty={t("empty")} />
        </div>
        <div className="crm-card">
          <h2>{t("charts.funnel")}</h2>
          <p className="crm-explain">{t("charts.funnelExplain")}</p>
          <BarChart
            id="crm-funnel"
            rows={data.funnel.map((step) => ({ key: step.code, label: step.label, value: step.reached, note: step.ofPrevious === null ? undefined : t("charts.ofPrevious", { percent: step.ofPrevious }) }))}
            caption={t("charts.funnelCaption")}
            columns={{ label: t("columns.stage"), value: t("columns.reached") }}
            empty={t("empty")}
          />
        </div>
        <div className="crm-card">
          <h2>{t("charts.countries")}</h2>
          <p className="crm-explain">{t("charts.countriesExplain")}</p>
          <BarChart id="crm-countries" rows={data.countries.map((c) => ({ key: c.key, label: countryLabel(c.key), value: c.count }))} caption={t("charts.countriesCaption")} columns={{ label: t("columns.country"), value: t("columns.count") }} empty={t("empty")} />
        </div>
        <div className="crm-card">
          <h2>{t("charts.sources")}</h2>
          <p className="crm-explain">{t("charts.sourcesExplain")}</p>
          <BarChart id="crm-sources" rows={data.sources.map((s) => ({ key: s.key, label: sourceLabel(s.key), value: s.count }))} caption={t("charts.sourcesCaption")} columns={{ label: t("columns.source"), value: t("columns.count") }} empty={t("empty")} />
        </div>
        {data.admins ? (
          <div className="crm-card" data-testid="crm-admins">
            <h2>{t("charts.admins")}</h2>
            <p className="crm-explain">{t("charts.adminsExplain")}</p>
            <BarChart
              id="crm-admins"
              rows={data.admins.map((admin) => ({ key: admin.userId, label: admin.name, value: admin.assigned, note: t("charts.adminNote", { answered: admin.answered, overdue: admin.overdue }) }))}
              caption={t("charts.adminsCaption")}
              columns={{ label: t("columns.admin"), value: t("columns.assigned") }}
              empty={t("empty")}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
