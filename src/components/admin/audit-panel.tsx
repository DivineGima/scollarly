"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { useAdminSession } from "./admin-shell";
import { Button } from "./ui/button";
import { FieldError, Input, Label } from "./ui/input";
import { ScrollRegion } from "./ui/scroll-region";
import { DataStatus } from "./use-admin-data";

interface AuditData {
  entries: { id: string; at: string; actorId: string | null; actorEmail: string | null; action: string; entityType: string; entityId: string | null }[];
  people: { id: string; email: string }[];
  actions: string[];
  nextBefore: string | null;
}

interface Filters {
  actor: string;
  action: string;
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { actor: "", action: "", from: "", to: "" };

function queryOf(filters: Filters, before?: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (before) params.set("before", before);
  const text = params.toString();
  return `/api/v1/admin/audit${text ? `?${text}` : ""}`;
}

/** C5: a read-only list of who did what, newest first, in WAT. Filters by person, action and date; older entries load on request. */
export function AuditPanel() {
  const t = useTranslations("admin.audit");
  const common = useTranslations("admin.common");
  const session = useAdminSession();
  const id = useId();
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [data, setData] = useState<AuditData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "filters">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (filters: Filters) => {
    setStatus("loading");
    const result = await api<AuditData>("GET", queryOf(filters));
    if (result.ok) {
      setData(result.data);
      setStatus("ready");
    } else if (result.status === 401) window.location.replace("/sign-in");
    else setStatus(result.code === "VALIDATION" ? "filters" : "error");
  }, []);

  useEffect(() => {
    if (session.role === "owner") void load(applied);
  }, [applied, load, session.role]);

  async function more() {
    if (!data?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    const result = await api<AuditData>("GET", queryOf(applied, data.nextBefore));
    setLoadingMore(false);
    if (result.ok) setData({ ...data, entries: [...data.entries, ...result.data.entries], nextBefore: result.data.nextBefore });
    else setStatus("error");
  }

  function actionLabel(action: string): string {
    const key = `actions.${action.replace(/\./g, "_")}`;
    return t.has(key) ? t(key) : action;
  }

  if (session.role !== "owner") return null;

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>

      <form
        className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(draft);
        }}
      >
        <div>
          <Label htmlFor={`${id}-actor`}>{t("filterPerson")}</Label>
          <select id={`${id}-actor`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.actor} onChange={(event) => setDraft({ ...draft, actor: event.target.value })}>
            <option value="">{t("all")}</option>
            {(data?.people ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${id}-action`}>{t("filterAction")}</Label>
          <select id={`${id}-action`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })}>
            <option value="">{t("all")}</option>
            {(data?.actions ?? []).map((action) => (
              <option key={action} value={action}>
                {actionLabel(action)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${id}-from`}>{t("filterFrom")}</Label>
          <Input id={`${id}-from`} type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${id}-to`}>{t("filterTo")}</Label>
          <Input id={`${id}-to`} type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </div>
        <div className="flex items-end">
          <Button type="submit">{t("apply")}</Button>
        </div>
      </form>

      {status === "filters" ? <div className="mt-4"><FieldError>{t("errorFilters")}</FieldError></div> : null}
      <div className="mt-6">
        <DataStatus state={status === "loading" ? { status: "loading" } : status === "error" ? { status: "error", httpStatus: 0 } : { status: "ready", data: null }} reload={() => void load(applied)} />
      </div>

      {status === "ready" && data ? (
        data.entries.length === 0 ? (
          <p className="text-fg-muted">{t("empty")}</p>
        ) : (
          <>
            <ScrollRegion label={t("title")}>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border text-sm text-fg-muted">
                    <th className="py-2 pr-4">{t("colWhen")}</th>
                    <th className="py-2 pr-4">{t("colWho")}</th>
                    <th className="py-2 pr-4">{t("colWhat")}</th>
                    <th className="py-2">{t("colRecord")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border align-top">
                      <td className="py-2 pr-4 whitespace-nowrap">{formatWat(new Date(entry.at))}</td>
                      <td className="py-2 pr-4 break-all">{entry.actorEmail ?? (entry.actorId ? t("former") : t("system"))}</td>
                      <td className="py-2 pr-4">{actionLabel(entry.action)}</td>
                      <td className="py-2 break-all text-sm text-fg-muted">
                        {entry.entityType}
                        {entry.entityId ? ` · ${entry.entityId}` : ""}
                      </td>
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
    </section>
  );
}
