"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { ContentTypeKey } from "@/modules/content-admin/definitions";
import { Badge } from "../ui/badge";
import { buttonVariants, Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { Input, Label } from "../ui/input";
import { DataStatus } from "../use-admin-data";
import { contentRoute, failureKey, refreshPublicSite, type Revalidate, type Status, StatusBadge } from "./shared";

interface ListItem {
  id: string;
  label: string;
  status: Status;
  version: string;
  publishedAt: string | null;
  flag: "stale" | "needs_consent" | null;
}

interface ListData {
  type: ContentTypeKey;
  items: ListItem[];
  truncated: boolean;
}

type Action = "unpublish" | "archive" | "restore";
const STATUSES: readonly ("" | Status)[] = ["", "draft", "published", "archived"];

/** B6 step 1 and 8: a list with search and status chips, "New", and unpublish, archive and restore on each row. */
export function ContentList() {
  const t = useTranslations("admin.content");
  const common = useTranslations("admin.common");
  const id = useId();
  const [type, setType] = useState<ContentTypeKey | null | undefined>(undefined);
  const [status, setStatus] = useState<"" | Status>("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [data, setData] = useState<ListData | null>(null);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; httpStatus: number }>({ status: "loading", httpStatus: 0 });
  const [confirm, setConfirm] = useState<{ item: ListItem; action: Action } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => setType(contentRoute(window.location.pathname).type), []);

  const load = useCallback(async () => {
    if (!type) return;
    const mine = ++latest.current;
    setState({ status: "loading", httpStatus: 0 });
    const params = new URLSearchParams({ type });
    if (status) params.set("status", status);
    if (applied) params.set("q", applied);
    const result = await api<ListData>("GET", `/api/v1/admin/content-list?${params}`);
    if (mine !== latest.current) return;
    if (result.ok) {
      setData(result.data);
      setState({ status: "ready", httpStatus: 200 });
    } else if (result.status === 401) window.location.replace("/sign-in");
    else setState({ status: "error", httpStatus: result.status });
  }, [type, status, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    if (!confirm || !type || busy) return;
    setBusy(true);
    const { item, action } = confirm;
    const result = await api<{ revalidate: Revalidate | null }>("POST", `/api/v1/admin/content.${action}`, { type, id: item.id, version: item.version });
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      setNotice({ kind: "error", text: t(`errors.${failureKey(result)}`) });
      void load();
      return;
    }
    const told = await refreshPublicSite(result.data.revalidate);
    setNotice({ kind: told ? "ok" : "warn", text: told ? t(`done.${action}`) : t("done.siteSlow") });
    void load();
  }

  if (type === undefined) return null;
  if (type === null) return <p role="alert">{t("unknownType")}</p>;

  return (
    <section>
      <p>
        <a href="/admin/content" className="underline">
          {t("back")}
        </a>
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t(`types.${type}.name`)}</h1>
        <a href={`/admin/content/${type}/new`} className={buttonVariants()} data-testid="new">
          {t("new")}
        </a>
      </div>
      <p className="mt-2 text-fg-muted">{t(`types.${type}.about`)}</p>

      {notice ? (
        <p role="status" className={cn("mt-4 rounded-md border p-3", notice.kind === "ok" ? "border-success text-success" : notice.kind === "warn" ? "border-warning text-warning" : "border-danger text-danger")}>
          {notice.text}
        </p>
      ) : null}

      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(q.trim());
        }}
      >
        <div className="min-w-48 flex-1">
          <Label htmlFor={`${id}-q`}>{t("search")}</Label>
          <Input id={`${id}-q`} type="search" maxLength={100} value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        <Button type="submit" variant="outline">
          {t("searchButton")}
        </Button>
      </form>

      <ul className="mt-4 flex flex-wrap gap-1" aria-label={t("statusFilter")}>
        {STATUSES.map((s) => (
          <li key={s || "all"}>
            <button
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={cn("inline-flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-surface", status === s && "bg-surface")}
            >
              {s ? t(`status.${s}`) : t("status.all")}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <DataStatus state={state.status === "error" ? { status: "error", httpStatus: state.httpStatus } : state.status === "loading" && !data ? { status: "loading" } : { status: "ready", data: null }} reload={() => void load()} />
      </div>

      {data ? (
        data.items.length === 0 ? (
          <p className="mt-4 text-fg-muted">{applied || status ? t("emptyFiltered") : t("empty")}</p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border" data-testid="items">
              {data.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <a href={`/admin/content/${type}/${item.id}`} className="block break-words font-semibold underline">
                      {item.label || t("untitled")}
                    </a>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <StatusBadge status={item.status} />
                      {item.flag ? <Badge variant="warning">{t(`flags.${item.flag}`)}</Badge> : null}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.status === "published" ? (
                      <Button size="sm" variant="outline" onClick={() => setConfirm({ item, action: "unpublish" })}>
                        {t("actions.unpublish")}
                      </Button>
                    ) : null}
                    {item.status !== "archived" ? (
                      <Button size="sm" variant="outline" onClick={() => setConfirm({ item, action: "archive" })}>
                        {t("actions.archive")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirm({ item, action: "restore" })}>
                        {t("actions.restore")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {data.truncated ? <p className="mt-2 text-fg-muted">{t("truncated")}</p> : null}
          </>
        )
      ) : null}

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={confirm ? t(`confirm.${confirm.action}.title`) : ""}>
        {confirm ? (
          <>
            <p className="break-words">{confirm.item.label}</p>
            <p className="mt-2 text-fg-muted">{t(`confirm.${confirm.action}.body`)}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>
                {common("cancel")}
              </Button>
              <Button variant={confirm.action === "restore" ? "default" : "destructive"} disabled={busy} onClick={() => void run()}>
                {t(`actions.${confirm.action}`)}
              </Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
