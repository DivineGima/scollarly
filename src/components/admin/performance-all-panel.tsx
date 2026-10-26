"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { DAY_MS, watDateString } from "@/lib/time";
import { useAdminSession } from "./admin-shell";
import { duration } from "./analytics-panel";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/input";
import { ScrollRegion } from "./ui/scroll-region";
import { DataStatus } from "./use-admin-data";

interface AdminRow {
  userId: string;
  email: string;
  name: string;
  role: "admin" | "owner";
  assigned: number;
  answered: number;
  medianMinutes: number | null;
  meanMinutes: number | null;
  overdue: number;
}

interface PerformanceAllData {
  range: { from: string; to: string };
  admins: AdminRow[];
}

interface Range {
  from: string;
  to: string;
}

const today = () => watDateString(new Date());
const defaultRange = (): Range => ({ from: watDateString(new Date(Date.now() - 29 * DAY_MS)), to: today() });

function rangeFromSearch(search: string): Range {
  const params = new URLSearchParams(search);
  const base = defaultRange();
  return { from: params.get("from") ?? base.from, to: params.get("to") ?? base.to };
}

/** C3: every admin's numbers side by side, for the owner. An admin sees only their own on the Analytics screen. */
export function PerformanceAllPanel() {
  const t = useTranslations("admin.performanceAll");
  const analytics = useTranslations("admin.analytics");
  const session = useAdminSession();
  const id = useId();
  const [applied, setApplied] = useState<Range | null>(null);
  const [draft, setDraft] = useState<Range>(defaultRange);
  const [data, setData] = useState<PerformanceAllData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "filters">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const read = () => {
      const range = rangeFromSearch(window.location.search);
      setApplied(range);
      setDraft(range);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const load = useCallback(async (range: Range) => {
    const mine = ++latest.current;
    setState("loading");
    setProblem(null);
    const result = await api<PerformanceAllData>("GET", `/api/v1/admin/performance-all?${new URLSearchParams({ from: range.from, to: range.to })}`);
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
    if (applied && session.role === "owner") void load(applied);
  }, [applied, load, session.role]);

  function apply(next: Range) {
    window.history.pushState(null, "", `${window.location.pathname}?${new URLSearchParams({ from: next.from, to: next.to })}`);
    setApplied(next);
    setDraft(next);
  }

  if (session.role !== "owner") return null;

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>
      <p className="mt-2">
        <a href="/admin/analytics?tab=performance" className="underline">
          {t("back")}
        </a>
      </p>

      <form
        className="mt-4 grid gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <div>
          <Label htmlFor={`${id}-from`}>{analytics("filters.from")}</Label>
          <Input id={`${id}-from`} type="date" max={today()} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${id}-to`}>{analytics("filters.to")}</Label>
          <Input id={`${id}-to`} type="date" max={today()} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </div>
        <div className="flex items-end">
          <Button type="submit">{analytics("filters.apply")}</Button>
        </div>
      </form>

      <div className="mt-6" aria-live="polite">
        {state === "filters" ? (
          <p role="alert" className="text-danger">
            {analytics(`problems.${problem ?? "INVALID"}` as "problems.INVALID")}
          </p>
        ) : (
          <DataStatus state={state === "error" ? { status: "error", httpStatus: 500 } : state === "loading" ? { status: "loading" } : { status: "ready", data: null }} reload={() => applied && void load(applied)} />
        )}
      </div>

      {state === "ready" && data ? (
        <>
          <p className="text-fg-muted">{t("range", { from: data.range.from, to: data.range.to })}</p>
          {data.admins.length === 0 ? (
            <p className="mt-3 text-fg-muted">{t("empty")}</p>
          ) : (
            <ScrollRegion label={t("title")} className="mt-3">
              <table className="w-full text-left" data-testid="performance-all">
                <thead>
                  <tr className="border-b border-border text-sm text-fg-muted">
                    <th className="py-2 pr-4">{t("colAdmin")}</th>
                    <th className="py-2 pr-4 text-right">{t("colAssigned")}</th>
                    <th className="py-2 pr-4 text-right">{t("colAnswered")}</th>
                    <th className="py-2 pr-4 text-right">{t("colMedian")}</th>
                    <th className="py-2 text-right">{t("colOverdue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.admins.map((admin) => (
                    <tr key={admin.userId} className="border-b border-border align-top">
                      <td className="py-2 pr-4">
                        <a href={`/admin/leads?assigned=${encodeURIComponent(admin.userId)}`} className="font-semibold underline">
                          {admin.name || admin.email}
                        </a>
                        <span className="block break-all text-sm text-fg-muted">{admin.email}</span>
                      </td>
                      <td className="py-2 pr-4 text-right">{admin.assigned}</td>
                      <td className="py-2 pr-4 text-right">{admin.answered}</td>
                      <td className="py-2 pr-4 text-right">{duration(analytics, admin.medianMinutes)}</td>
                      <td className="py-2 text-right">{admin.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          <p className="mt-4 text-sm text-fg-muted">{analytics("performance.basis")}</p>
        </>
      ) : null}
    </section>
  );
}
