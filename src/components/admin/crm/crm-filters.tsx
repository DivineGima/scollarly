"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { STUDENT_COUNTRIES } from "@/lib/constants";
import { ASSIGNED, type Assigned } from "@/modules/crm/metrics";

export interface AppliedFilters {
  from: string;
  to: string;
  country: string;
  source: string;
  assigned: Assigned | "";
}

/** The filters in the address of the page, read in the browser (the page itself is the same HTML for everyone). */
export function readAppliedFilters(search: string): AppliedFilters {
  const params = new URLSearchParams(search);
  const assigned = params.get("assigned");
  return {
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    country: params.get("country") ?? "",
    source: params.get("source") ?? "",
    assigned: (ASSIGNED as readonly string[]).includes(assigned ?? "") ? (assigned as Assigned) : "",
  };
}

/** The query string the data calls and the export take: only the five filters, empty ones left out. */
export function filterQuery(applied: AppliedFilters, only: readonly (keyof AppliedFilters)[] = ["from", "to", "country", "source", "assigned"]): string {
  const params = new URLSearchParams();
  for (const key of only) if (applied[key]) params.set(key, applied[key]);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * The CRM filters (PRD_3 F18 amended). A plain GET form to the same page: it works with no script, the address carries the filters so a view
 * can be bookmarked, and the export link is built from the same address. `withDates` is false for the board, which shows every open lead.
 */
export function CrmFilters({ view, applied, sources, withDates = true }: { view: string; applied: AppliedFilters; sources: readonly string[]; withDates?: boolean }) {
  const t = useTranslations("admin.crm.filters");
  const locale = useLocale();
  const countryName = useMemo(() => {
    try {
      const names = new Intl.DisplayNames([locale], { type: "region" });
      return (code: string) => names.of(code) ?? code;
    } catch {
      return (code: string) => code;
    }
  }, [locale]);
  const sourceOptions = [...new Set([...sources, ...(applied.source ? [applied.source] : [])])];

  return (
    <form className="crm-filters" method="get" aria-label={t("label")} data-testid="crm-filters">
      <input type="hidden" name="view" value={view} />
      {withDates ? (
        <>
          <label>
            {t("from")}
            <input type="date" name="from" defaultValue={applied.from} />
          </label>
          <label>
            {t("to")}
            <input type="date" name="to" defaultValue={applied.to} />
          </label>
        </>
      ) : null}
      <label>
        {t("country")}
        <select name="country" defaultValue={applied.country}>
          <option value="">{t("all")}</option>
          {STUDENT_COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {countryName(code)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("source")}
        <select name="source" defaultValue={applied.source}>
          <option value="">{t("all")}</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("assigned")}
        <select name="assigned" defaultValue={applied.assigned}>
          <option value="">{t("assignedAll")}</option>
          <option value="me">{t("assignedMe")}</option>
          <option value="unassigned">{t("assignedUnassigned")}</option>
        </select>
      </label>
      <button type="submit">{t("apply")}</button>
    </form>
  );
}
