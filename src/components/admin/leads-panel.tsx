"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { DuplicateDialog } from "./leads/duplicate-dialog";
import { type DuplicatePairData, type LeadListItem, type Person, SlaBadge, type StageOption, stageName } from "./leads/shared";
import { Button } from "./ui/button";
import { FieldError, Input, Label } from "./ui/input";
import { ScrollRegion } from "./ui/scroll-region";
import { DataStatus } from "./use-admin-data";

/** The countries students come from (architecture 7.2 `STUDENT_COUNTRIES`), for the filter. */
const COUNTRIES = ["CM", "NG", "GH", "CI", "SN", "GN", "ZA", "IN"] as const;

type View = "all" | "unanswered" | "overdue" | "unassigned" | "duplicates";
const VIEWS: readonly View[] = ["all", "overdue", "unassigned", "duplicates"];
const KNOWN_VIEWS: readonly string[] = ["all", "unanswered", "overdue", "unassigned", "duplicates"];

interface Filters {
  view: View;
  stage: string;
  country: string;
  university: string;
  assigned: string;
  q: string;
}

const NO_FILTERS: Filters = { view: "all", stage: "", country: "", university: "", assigned: "", q: "" };

interface LeadsData {
  leads: LeadListItem[];
  nextBefore: string | null;
  stages: StageOption[];
  universities: { id: string; name: string }[];
  admins: Person[];
}

/** The filters live in the URL (B2 step 2), so a list can be bookmarked and the browser's Back button works. */
export function filtersFromSearch(search: string): Filters {
  const params = new URLSearchParams(search);
  const view = params.get("view") ?? "all";
  return {
    view: (KNOWN_VIEWS.includes(view) ? view : "all") as View,
    stage: params.get("stage") ?? "",
    country: params.get("country") ?? "",
    university: params.get("university") ?? "",
    assigned: params.get("assigned") ?? "",
    q: params.get("q") ?? "",
  };
}

export function searchFromFilters(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.view !== "all") params.set("view", filters.view);
  for (const key of ["stage", "country", "university", "assigned", "q"] as const) if (filters[key]) params.set(key, filters[key]);
  const text = params.toString();
  return text ? `?${text}` : "";
}

function dataPath(filters: Filters, before?: string): string {
  const params = new URLSearchParams();
  if (filters.view !== "all") params.set("view", filters.view);
  for (const key of ["stage", "country", "university", "assigned", "q"] as const) if (filters[key]) params.set(key, filters[key]);
  if (before) params.set("before", before);
  const text = params.toString();
  return `/api/v1/admin/leads${text ? `?${text}` : ""}`;
}

/** B2: the leads list with tabs, filters, search and paging. */
export function LeadsPanel() {
  const t = useTranslations("admin.leads");
  const common = useTranslations("admin.common");
  const id = useId();
  const [applied, setApplied] = useState<Filters | null>(null);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [data, setData] = useState<LeadsData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "filters">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  // The shell is the same HTML for every address, so the filters are read in the browser.
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
    setStatus("loading");
    const result = await api<LeadsData>("GET", dataPath(filters));
    if (result.ok) {
      setData(result.data);
      setStatus("ready");
    } else if (result.status === 401) window.location.replace("/sign-in");
    else setStatus(result.code === "VALIDATION" ? "filters" : "error");
  }, []);

  useEffect(() => {
    if (applied && applied.view !== "duplicates") void load(applied);
  }, [applied, load]);

  function apply(next: Filters) {
    window.history.pushState(null, "", `${window.location.pathname}${searchFromFilters(next)}`);
    setApplied(next);
    setDraft(next);
  }

  async function more() {
    if (!applied || !data?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    const result = await api<LeadsData>("GET", dataPath(applied, data.nextBefore));
    setLoadingMore(false);
    if (result.ok) setData({ ...data, leads: [...data.leads, ...result.data.leads], nextBefore: result.data.nextBefore });
    else setStatus("error");
  }

  if (!applied) return null;
  const stages = data?.stages ?? [];

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>

      <nav aria-label={t("tabs.label")} className="mt-4">
        <ul className="flex flex-wrap gap-1">
          {VIEWS.map((view) => (
            <li key={view}>
              <button
                type="button"
                aria-current={applied.view === view || (view === "all" && applied.view === "unanswered") ? "page" : undefined}
                onClick={() => apply({ ...NO_FILTERS, view })}
                className={`inline-flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-surface ${applied.view === view ? "bg-surface" : ""}`}
              >
                {t(`tabs.${view}`)}
              </button>
            </li>
          ))}
          <li>
            <a href="/admin/leads/link-requests" className="inline-flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-surface">
              {t("tabs.linkRequests")}
            </a>
          </li>
        </ul>
      </nav>

      {applied.view === "duplicates" ? (
        <DuplicatesList />
      ) : (
        <>
          <form
            className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              apply({ ...draft, q: draft.q.trim() });
            }}
          >
            <div className="sm:col-span-2 lg:col-span-3">
              <Label htmlFor={`${id}-q`}>{t("filters.search")}</Label>
              <Input id={`${id}-q`} type="search" maxLength={80} value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${id}-stage`}>{t("filters.stage")}</Label>
              <select id={`${id}-stage`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value })}>
                <option value="">{t("filters.any")}</option>
                {stages.map((s) => (
                  <option key={s.code} value={s.code}>
                    {stageName(stages, s.code)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`${id}-country`}>{t("filters.country")}</Label>
              <select id={`${id}-country`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}>
                <option value="">{t("filters.any")}</option>
                {COUNTRIES.map((code) => (
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
                {(data?.universities ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`${id}-assigned`}>{t("filters.assigned")}</Label>
              <select id={`${id}-assigned`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.assigned} onChange={(event) => setDraft({ ...draft, assigned: event.target.value })}>
                <option value="">{t("filters.any")}</option>
                <option value="me">{t("filters.me")}</option>
                <option value="none">{t("filters.nobody")}</option>
                {(data?.admins ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2 lg:col-span-2">
              <Button type="submit">{t("filters.apply")}</Button>
              <Button type="button" variant="outline" onClick={() => apply({ ...NO_FILTERS, view: applied.view })}>
                {t("filters.clear")}
              </Button>
            </div>
          </form>

          {status === "filters" ? (
            <div className="mt-4">
              <FieldError>{t("errorFilters")}</FieldError>
            </div>
          ) : null}
          <div className="mt-6">
            <DataStatus state={status === "loading" ? { status: "loading" } : status === "error" ? { status: "error", httpStatus: 0 } : { status: "ready", data: null }} reload={() => void load(applied)} />
          </div>

          {status === "ready" && data ? (
            data.leads.length === 0 ? (
              <p className="text-fg-muted">{applied.view === "overdue" ? t("emptyOverdue") : t("empty")}</p>
            ) : (
              <>
                <ScrollRegion label={t("title")}>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border text-sm text-fg-muted">
                        <th className="py-2 pr-4">{t("columns.ref")}</th>
                        <th className="py-2 pr-4">{t("columns.name")}</th>
                        <th className="py-2 pr-4">{t("columns.country")}</th>
                        <th className="py-2 pr-4">{t("columns.stage")}</th>
                        <th className="py-2 pr-4">{t("columns.assigned")}</th>
                        <th className="py-2 pr-4">{t("columns.sla")}</th>
                        <th className="py-2">{t("columns.received")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leads.map((lead) => (
                        <tr key={lead.id} className="border-b border-border align-top">
                          <td className="py-2 pr-4 whitespace-nowrap">
                            <a className="font-semibold text-accent underline" href={`/admin/leads/${lead.id}`}>
                              {lead.ref}
                            </a>
                          </td>
                          <td className="py-2 pr-4">{lead.erased ? <span className="text-fg-muted">{t("erasedName")}</span> : lead.name}</td>
                          <td className="py-2 pr-4">{lead.country}</td>
                          <td className="py-2 pr-4">{stageName(stages, lead.stage)}</td>
                          <td className="py-2 pr-4">{lead.assigned ? lead.assigned.label || t("formerAdmin") : <span className="text-fg-muted">{t("unassignedValue")}</span>}</td>
                          <td className="py-2 pr-4 whitespace-nowrap">{lead.erased ? null : <SlaBadge sla={lead.sla} />}</td>
                          <td className="py-2 whitespace-nowrap">{formatWat(new Date(lead.receivedAt))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
                {data.nextBefore ? (
                  <Button className="mt-4" variant="outline" disabled={loadingMore} onClick={() => void more()}>
                    {loadingMore ? common("loading") : t("loadMore")}
                  </Button>
                ) : null}
              </>
            )
          ) : null}
        </>
      )}
    </section>
  );
}

/** B2 tab "Duplicates": pairs with the same WhatsApp number. A query, never merged automatically. */
function DuplicatesList() {
  const t = useTranslations("admin.leads.duplicates");
  const [pairs, setPairs] = useState<DuplicatePairData[] | null>(null);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = useState<DuplicatePairData | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    const result = await api<{ pairs: DuplicatePairData[]; stages: StageOption[] }>("GET", "/api/v1/admin/duplicates");
    if (result.ok) {
      setPairs(result.data.pairs);
      setStages(result.data.stages);
      setStatus("ready");
    } else if (result.status === 401) window.location.replace("/sign-in");
    else setStatus("error");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-6">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="mt-1 text-fg-muted">{t("intro")}</p>
      <div className="mt-4">
        <DataStatus state={status === "loading" ? { status: "loading" } : status === "error" ? { status: "error", httpStatus: 0 } : { status: "ready", data: null }} reload={() => void load()} />
      </div>
      {status === "ready" && pairs ? (
        pairs.length === 0 ? (
          <p className="text-fg-muted">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {pairs.map((pair) => (
              <li key={`${pair.a.id}-${pair.b.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <span>
                  <span className="font-semibold">{pair.a.ref}</span> · {pair.a.name} <span className="text-fg-muted">&amp;</span> <span className="font-semibold">{pair.b.ref}</span> · {pair.b.name}
                </span>
                <Button variant="outline" size="sm" onClick={() => setOpen(pair)}>
                  {t("compare")}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <DuplicateDialog
        pair={open}
        stages={stages}
        onClose={() => setOpen(null)}
        onResolved={() => {
          setOpen(null);
          void load();
        }}
      />
    </div>
  );
}
