"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import "@/components/shell/shell.css";
import { AnalyticsPanel } from "./analytics-panel";
import { ContentHub } from "./content/hub-panel";
import { MediaPanel } from "./content/media-panel";
import { StalePanel } from "./content/stale-panel";
import { DataRequestsPanel } from "./data-requests-panel";
import { LeadsPanel } from "./leads-panel";
import { LinkRequestsPanel } from "./link-requests-panel";
import { PaymentsPanel } from "./payments-panel";

interface Section {
  key: string;
  label: string;
}

/**
 * The sections of a hub (architecture 21.4, 21.10): links to the same cached shell with `?view=`, each section being one data call. The
 * current one is marked. They are plain links, so the section works with no script and an old bookmark lands on the right one.
 */
export function SectionTabs({ label, base, current, sections }: { label: string; base: string; current: string; sections: readonly Section[] }) {
  return (
    <nav aria-label={label} className="hub-sections">
      <ul>
        {sections.map((section) => (
          <li key={section.key}>
            <a href={section.key === sections[0]?.key ? base : `${base}?view=${section.key}`} aria-current={current === section.key ? "page" : undefined}>
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The `?view=` of the address, read in the browser (the page itself is the same HTML for everyone). Null until it has been read. */
function useView(): string | null {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => setView(new URLSearchParams(window.location.search).get("view") ?? ""), []);
  return view;
}

function Loading() {
  const t = useTranslations("admin.hub");
  return <p role="status">{t("loading")}</p>;
}

/** Leads: the list (with its own views: all, overdue, unassigned, duplicates), the link requests, and the data requests. */
export function LeadsHub() {
  const t = useTranslations("admin.hub");
  const view = useView();
  if (view === null) return <Loading />;
  const current = view === "link-requests" || view === "data-requests" ? view : "leads";
  return (
    <>
      <SectionTabs
        label={t("label")}
        base="/admin/leads"
        current={current}
        sections={[
          { key: "leads", label: t("leads.leads") },
          { key: "link-requests", label: t("leads.linkRequests") },
          { key: "data-requests", label: t("leads.dataRequests") },
        ]}
      />
      {current === "link-requests" ? <LinkRequestsPanel /> : current === "data-requests" ? <DataRequestsPanel /> : <LeadsPanel />}
    </>
  );
}

/** Content: the kinds of content with their counts, the list of what is stale, and the images. */
export function ContentSections() {
  const t = useTranslations("admin.hub");
  const view = useView();
  if (view === null) return <Loading />;
  const current = view === "stale" || view === "media" ? view : "overview";
  return (
    <>
      <SectionTabs
        label={t("label")}
        base="/admin/content"
        current={current}
        sections={[
          { key: "overview", label: t("content.overview") },
          { key: "stale", label: t("content.stale") },
          { key: "media", label: t("content.media") },
        ]}
      />
      {current === "stale" ? <StalePanel /> : current === "media" ? <MediaPanel /> : <ContentHub />}
    </>
  );
}

/** Insights: results (funnel, sources and the person's own numbers, with the owner's all-admins view inside) and payments. */
export function InsightsHub() {
  const t = useTranslations("admin.hub");
  const view = useView();
  if (view === null) return <Loading />;
  const current = view === "payments" ? "payments" : "results";
  return (
    <>
      <SectionTabs
        label={t("label")}
        base="/admin/insights"
        current={current}
        sections={[
          { key: "results", label: t("insights.results") },
          { key: "payments", label: t("insights.payments") },
        ]}
      />
      {current === "payments" ? <PaymentsPanel /> : <AnalyticsPanel />}
    </>
  );
}
