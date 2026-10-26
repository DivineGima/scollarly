"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { FieldError, Input, Label } from "../ui/input";
import { DataStatus, useAdminData } from "../use-admin-data";
import { ImageUpload } from "./image-upload";
import { MEDIA_WARN_SHARE } from "./hub-panel";
import { failureKey, formatBytes, mediaSrc, refreshPublicSite, type Revalidate, StatusBadge, type Status } from "./shared";

interface MediaItem {
  id: string;
  kind: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  createdAt: string;
  archived: boolean;
  usedBy: number;
}

interface MediaData {
  items: MediaItem[];
  usedBytes: number;
  budgetBytes: number;
}

interface Use {
  type: string;
  id: string;
  label: string;
  status: Status;
}

/** B7: the image library, its meter against the budget, and one image's alt text, uses and archive. */
export function MediaPanel() {
  const t = useTranslations("admin.content.media");
  const { state, reload } = useAdminData<MediaData>("/api/v1/admin/media");
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = state.status === "ready" ? state.data : null;
  const share = data && data.budgetBytes > 0 ? data.usedBytes / data.budgetBytes : 0;

  return (
    <section>
      <p>
        <a href="/admin/content" className="underline">
          {t("back")}
        </a>
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button onClick={() => setUploading(true)} data-testid="upload">
          {t("upload")}
        </Button>
      </div>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>
      <div className="mt-4">
        <DataStatus state={state} reload={reload} />
      </div>
      {notice ? (
        <p role="status" className="mt-4 rounded-md border border-success p-3 text-success">
          {notice}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="mt-4">
            <p data-testid="meter">{t("meter", { used: formatBytes(data.usedBytes), budget: formatBytes(data.budgetBytes), percent: Math.round(share * 100) })}</p>
            <div className="mt-1 h-2 rounded-full bg-surface" aria-hidden="true">
              <div className={cn("h-2 rounded-full", share >= MEDIA_WARN_SHARE ? "bg-warning" : "bg-accent")} style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
            </div>
            {share >= MEDIA_WARN_SHARE ? (
              <p role="alert" className="mt-2 rounded-md border border-warning p-3 text-warning">
                {t("banner", { percent: Math.round(share * 100) })}
              </p>
            ) : null}
          </div>

          {data.items.length === 0 ? (
            <p className="mt-6 text-fg-muted">{t("empty")}</p>
          ) : (
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="grid">
              {data.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(item)}
                    className="block w-full rounded-lg border border-border p-2 text-left hover:bg-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- our own immutable /media/<hash> address */}
                    <img src={mediaSrc(item.sha256)} alt={item.alt} width={item.width} height={item.height} loading="lazy" className={cn("aspect-square w-full rounded object-cover", item.archived && "opacity-50")} />
                    <span className="mt-1 block truncate text-sm font-semibold">{item.alt || t(`kinds.${item.kind}` as "kinds.photo")}</span>
                    <span className="block text-sm text-fg-muted">
                      {formatBytes(item.bytes)} · {item.width}×{item.height}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {item.archived ? <Badge>{t("archived")}</Badge> : item.usedBy > 0 ? <Badge variant="success">{t("used", { count: item.usedBy })}</Badge> : <Badge variant="warning">{t("unused")}</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <ImageUpload
        open={uploading}
        onClose={() => setUploading(false)}
        defaultKind="photo"
        onUploaded={(_media, existing) => {
          setNotice(existing ? t("reused") : t("added"));
          reload();
        }}
      />
      <Detail
        item={open}
        onClose={() => setOpen(null)}
        onChanged={(message) => {
          setOpen(null);
          setNotice(message);
          reload();
        }}
      />
    </section>
  );
}

function Detail({ item, onClose, onChanged }: { item: MediaItem | null; onClose: () => void; onChanged: (message: string) => void }) {
  const t = useTranslations("admin.content.media");
  const common = useTranslations("admin.common");
  const id = useId();
  const [alt, setAlt] = useState("");
  const [uses, setUses] = useState<Use[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!item) return;
    setAlt(item.alt);
    setUses(null);
    setError(null);
    let live = true;
    void api<{ uses: Use[] }>("GET", `/api/v1/admin/media-item?id=${item.id}`).then((result) => {
      if (live && result.ok) setUses(result.data.uses);
    });
    return () => {
      live = false;
    };
  }, [item]);

  async function saveAlt(event: React.FormEvent) {
    event.preventDefault();
    if (!item || busy) return;
    setBusy(true);
    setError(null);
    const result = await api<{ revalidate: Revalidate }>("POST", "/api/v1/admin/media.setAlt", { id: item.id, alt: alt.trim() });
    if (!result.ok) {
      setBusy(false);
      setError(failureKey(result));
      return;
    }
    // The saved alt text is shown on public pages; the site refreshes now instead of within the hour. A refusal here is not an error:
    // the site catches up on its own.
    await refreshPublicSite(result.data.revalidate);
    setBusy(false);
    onChanged(t("altSaved"));
  }

  async function archive() {
    if (!item || busy) return;
    setBusy(true);
    setError(null);
    const result = await api<unknown>("POST", "/api/v1/admin/media.archive", { id: item.id });
    setBusy(false);
    if (!result.ok) setError(result.code === "CONFLICT" && result.fields.media === "IN_USE" ? "inUse" : failureKey(result));
    else onChanged(t("archivedDone"));
  }

  const liveUses = (uses ?? []).filter((u) => u.status !== "archived");
  return (
    <Dialog open={item !== null} onClose={onClose} title={t("detailTitle")} className="w-[min(36rem,calc(100vw-2rem))]">
      {item ? (
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own immutable /media/<hash> address */}
          <img src={mediaSrc(item.sha256)} alt={item.alt} width={item.width} height={item.height} className="max-h-64 w-auto max-w-full rounded-md border border-border" />
          <p className="text-sm text-fg-muted">
            {formatBytes(item.bytes)} · {item.width}×{item.height} · {t(`kinds.${item.kind}` as "kinds.photo")}
          </p>
          <form onSubmit={saveAlt}>
            <Label htmlFor={`${id}-alt`}>{t("alt")}</Label>
            <div className="flex flex-wrap gap-2">
              <Input id={`${id}-alt`} className="flex-1" maxLength={200} value={alt} onChange={(event) => setAlt(event.target.value)} />
              <Button type="submit" variant="outline" disabled={busy || alt.trim() === item.alt}>
                {t("saveAlt")}
              </Button>
            </div>
          </form>
          <div>
            <h3 className="font-semibold">{t("usedIn")}</h3>
            {uses === null ? (
              <p role="status">{t("loadingUses")}</p>
            ) : uses.length === 0 ? (
              <p className="text-fg-muted">{t("noUses")}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {uses.map((u) => (
                  <li key={`${u.type}-${u.id}`} className="flex flex-wrap items-center gap-2">
                    <a href={`/admin/content/${u.type}/${u.id}`} className="underline">
                      {u.label}
                    </a>
                    <StatusBadge status={u.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error ? <FieldError>{t(`errors.${error}` as "errors.generic")}</FieldError> : null}
          {error === "inUse" && liveUses.length > 0 ? <p className="text-sm text-fg-muted">{t("inUseHelp")}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {common("close")}
            </Button>
            {!item.archived ? (
              <Button variant="destructive" disabled={busy || liveUses.length > 0} onClick={() => void archive()}>
                {t("archive")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
