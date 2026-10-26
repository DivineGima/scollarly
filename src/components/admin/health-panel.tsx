"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { formatBytes, type UsageLevel } from "@/modules/health/service";
import { useAdminSession } from "./admin-shell";
import { useStepUp } from "./step-up";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { FieldError } from "./ui/input";
import { DataStatus, useAdminData } from "./use-admin-data";

interface UsageView {
  usedBytes: number;
  budgetBytes: number;
  ratio: number;
  level: UsageLevel;
}

interface JobView {
  job: "rollup" | "usage";
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastFailedAt: string | null;
}

interface HealthData {
  checkedAt: string;
  database: UsageView;
  images: UsageView;
  jobs: JobView[];
  stale: { fees: number; campus: number; resources: number };
  collectPageViews: boolean;
  pipeline: { days: number; active: number; fresh: number } | null;
}

/** Plain links to the places that hold what a Worker cannot read on the free plans: compute hours and request counts. */
const DASHBOARDS = [
  { key: "neon", href: "https://console.neon.tech" },
  { key: "cloudflare", href: "https://dash.cloudflare.com" },
  { key: "github", href: "https://github.com/settings/billing/summary" },
] as const;

function Meter({ label, usage }: { label: string; usage: UsageView }) {
  const t = useTranslations("admin.health");
  const percent = Math.min(Math.round(usage.ratio * 100), 999);
  return (
    <li className="rounded-lg border border-border p-4" data-testid={`meter-${usage.level}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{label}</h2>
        <Badge variant={usage.level === "ok" ? "success" : usage.level === "warn" ? "warning" : "danger"}>{t(`level.${usage.level}`)}</Badge>
      </div>
      <p className="mt-1 text-2xl font-semibold">{t("usedOf", { used: formatBytes(usage.usedBytes), budget: formatBytes(usage.budgetBytes), percent })}</p>
      <progress className="mt-2 h-3 w-full" max={100} value={Math.min(percent, 100)} aria-label={`${label}: ${percent}%`} />
      {usage.level !== "ok" ? (
        <p role="note" className={usage.level === "urgent" ? "mt-2 text-danger" : "mt-2 text-warning"}>
          {t(`banner.${usage.level}`, { percent })}
        </p>
      ) : null}
    </li>
  );
}

/** C7: the owner's Health page. Sizes, last job runs, stale counts, and the page-view switch (the kill switch, ADR-003). */
export function HealthPanel() {
  const t = useTranslations("admin.health");
  const common = useTranslations("admin.common");
  const session = useAdminSession();
  const stepUp = useStepUp();
  const { state, reload } = useAdminData<HealthData>(session.role === "owner" ? "/api/v1/admin/health" : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.role !== "owner") return null;

  async function toggle(collect: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await stepUp(() => api("POST", "/api/v1/admin/settings.update", { changes: { collect_page_views: collect } }));
    setBusy(false);
    if (result.ok) reload();
    else setError(result.code === "STEP_UP_REQUIRED" ? t("errorStepUp") : result.status === 0 ? t("errorNetwork") : t("errorGeneric"));
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button variant="outline" onClick={reload} disabled={state.status === "loading"}>
          {t("refresh")}
        </Button>
      </div>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>
      <div className="mt-4">
        <DataStatus state={state} reload={reload} />
      </div>

      {state.status === "ready" ? (
        <>
          <p className="text-sm text-fg-muted">{t("checkedAt", { date: formatWat(new Date(state.data.checkedAt)) })}</p>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            <Meter label={t("database")} usage={state.data.database} />
            <Meter label={t("images")} usage={state.data.images} />
          </ul>

          <h2 className="mt-8 text-xl font-semibold">{t("jobsTitle")}</h2>
          <ul className="mt-3 space-y-2">
            {state.data.jobs.map((job) => (
              <li key={job.job} className="rounded-md border border-border p-3" data-testid={`job-${job.job}`}>
                <p className="font-semibold">{t(`job.${job.job}`)}</p>
                <p className="text-sm text-fg-muted">
                  {job.lastOkAt ? t("lastOk", { date: formatWat(new Date(job.lastOkAt)) }) : t("neverRan")}
                  {job.lastFailedAt && (!job.lastOkAt || job.lastFailedAt > job.lastOkAt) ? <span className="ml-2 text-danger">{t("lastFailed", { date: formatWat(new Date(job.lastFailedAt)) })}</span> : null}
                </p>
              </li>
            ))}
          </ul>

          <h2 className="mt-8 text-xl font-semibold">{t("staleTitle")}</h2>
          <p className="mt-2" data-testid="stale">
            {state.data.stale.fees + state.data.stale.campus + state.data.stale.resources === 0
              ? t("staleNone")
              : t("staleCounts", { fees: state.data.stale.fees, tours: state.data.stale.campus, links: state.data.stale.resources })}{" "}
            <a href="/admin/content/stale" className="underline">
              {t("staleOpen")}
            </a>
          </p>

          {state.data.pipeline ? (
            <>
              <h2 className="mt-8 text-xl font-semibold">{t("pipelineTitle")}</h2>
              <p className="mt-2" data-testid="pipeline">
                {state.data.pipeline.active === 0
                  ? t("pipelineNone", { days: state.data.pipeline.days })
                  : t("pipelineShare", { fresh: state.data.pipeline.fresh, active: state.data.pipeline.active, days: state.data.pipeline.days })}
              </p>
            </>
          ) : null}

          <h2 className="mt-8 text-xl font-semibold">{t("flagsTitle")}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md border border-border p-3">
            <div className="flex-1">
              <p className="font-semibold">{t("collectLabel")}</p>
              <p className="text-sm text-fg-muted" data-testid="collect-state">
                {state.data.collectPageViews ? t("collectOn") : t("collectOff")}
              </p>
            </div>
            <Button variant={state.data.collectPageViews ? "outline" : "default"} disabled={busy} onClick={() => void toggle(!state.data.collectPageViews)}>
              {busy ? common("loading") : state.data.collectPageViews ? t("pause") : t("resume")}
            </Button>
          </div>
          {error ? <FieldError>{error}</FieldError> : null}

          <h2 className="mt-8 text-xl font-semibold">{t("linksTitle")}</h2>
          <p className="mt-2 text-fg-muted">{t("linksBody")}</p>
          <ul className="mt-3 space-y-2">
            {DASHBOARDS.map((link) => (
              <li key={link.key}>
                <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">
                  {t(`links.${link.key}`)}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
