"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { Button } from "../ui/button";
import { DataStatus, useAdminData } from "../use-admin-data";
import { failureKey, refreshPublicSite, type Revalidate } from "./shared";

interface StaleItem {
  type: "fees" | "campus" | "resources";
  id: string;
  label: string;
  version: string;
  checkedAt: string | null;
}

/** B8: published fees not updated for 180 days and links not checked for 90 days (the limits are the settings), with "Mark checked". */
export function StalePanel() {
  const t = useTranslations("admin.content.stale");
  const { state, reload } = useAdminData<{ items: StaleItem[] }>("/api/v1/admin/stale");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function mark(item: StaleItem) {
    if (busy) return;
    setBusy(item.id);
    const result = await api<{ revalidate: Revalidate | null }>("POST", "/api/v1/admin/content.markChecked", { type: item.type, id: item.id, version: item.version });
    setBusy(null);
    if (!result.ok) {
      setNotice({ ok: false, text: t(`errors.${failureKey(result)}` as "errors.generic") });
      reload();
      return;
    }
    await refreshPublicSite(result.data.revalidate);
    setNotice({ ok: true, text: t("marked") });
    reload();
  }

  const items = state.status === "ready" ? state.data.items : [];
  return (
    <section>
      <p>
        <a href="/admin/content" className="underline">
          {t("back")}
        </a>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>
      <div className="mt-4">
        <DataStatus state={state} reload={reload} />
      </div>
      {notice ? (
        <p role={notice.ok ? "status" : "alert"} className={`mt-4 rounded-md border p-3 ${notice.ok ? "border-success text-success" : "border-danger text-danger"}`}>
          {notice.text}
        </p>
      ) : null}
      {state.status === "ready" ? (
        items.length === 0 ? (
          <p className="mt-6" data-testid="all-fresh">
            {t("allFresh")}
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-border rounded-lg border border-border" data-testid="stale-items">
            {items.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <a href={`/admin/content/${item.type}/${item.id}`} className="block break-words font-semibold underline">
                    {item.label}
                  </a>
                  <span className="block text-sm text-fg-muted">
                    {t(`kind.${item.type}`)} · {item.checkedAt ? t("lastChecked", { date: formatWat(new Date(item.checkedAt)) }) : t("neverChecked")}
                  </span>
                </div>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void mark(item)}>
                  {t("mark")}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
