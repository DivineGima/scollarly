"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ImageKind } from "@/lib/image-caps";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { ImageUpload, type UploadedMedia } from "./image-upload";
import { mediaSrc } from "./shared";

export interface MediaOption {
  id: string;
  sha256: string;
  kind: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * An image field of a form (B6 step 4): shows the chosen picture, lets the person pick another from the library or upload a new one,
 * and clear it. Only the id is saved with the item; the page builds `/media/<hash>.webp` from the library.
 */
export function MediaPicker({
  id,
  value,
  options,
  kind,
  onChange,
  onUploaded,
  invalid,
  describedBy,
}: {
  id: string;
  value: string | null;
  options: MediaOption[];
  kind: ImageKind;
  onChange: (id: string | null) => void;
  onUploaded: (media: MediaOption) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations("admin.content.picker");
  const [choosing, setChoosing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const current = value ? options.find((o) => o.id === value) : undefined;

  function uploaded(media: UploadedMedia, existing: boolean) {
    const option: MediaOption = { id: media.id, sha256: media.sha256, kind: media.kind, width: media.width, height: media.height, alt: media.alt };
    onUploaded(option);
    onChange(media.id);
    setChoosing(false);
    setNotice(existing ? t("reused") : t("added"));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own immutable /media/<hash> address, sized from the stored width and height
          <img src={mediaSrc(current.sha256)} alt={current.alt} width={Math.min(current.width, 96)} height={Math.round((Math.min(current.width, 96) * current.height) / current.width)} className="rounded-md border border-border object-cover" loading="lazy" />
        ) : value ? (
          <span className="text-fg-muted">{t("missing")}</span>
        ) : (
          <span className="text-fg-muted">{t("none")}</span>
        )}
        <Button id={id} variant="outline" aria-invalid={invalid ? true : undefined} aria-describedby={describedBy} onClick={() => setChoosing(true)}>
          {value ? t("change") : t("choose")}
        </Button>
        {value ? (
          <Button variant="ghost" onClick={() => onChange(null)}>
            {t("remove")}
          </Button>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="mt-1 text-sm text-success">
          {notice}
        </p>
      ) : null}

      <Dialog open={choosing} onClose={() => setChoosing(false)} title={t("title")} className="w-[min(44rem,calc(100vw-2rem))]">
        <div className="space-y-4">
          <Button onClick={() => { setChoosing(false); setUploading(true); }}>{t("upload")}</Button>
          {options.length === 0 ? (
            <p className="text-fg-muted">{t("empty")}</p>
          ) : (
            <ul className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.id);
                      setChoosing(false);
                      setNotice(null);
                    }}
                    aria-pressed={o.id === value}
                    className={cn("block w-full rounded-md border p-1 text-left hover:bg-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent", o.id === value ? "border-accent" : "border-border")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- our own immutable /media/<hash> address */}
                    <img src={mediaSrc(o.sha256)} alt={o.alt} width={o.width} height={o.height} loading="lazy" className="aspect-square w-full rounded object-cover" />
                    <span className="mt-1 block truncate text-sm">{o.alt || t(`kinds.${o.kind}` as "kinds.photo")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setChoosing(false)}>
              {t("close")}
            </Button>
          </div>
        </div>
      </Dialog>

      <ImageUpload open={uploading} onClose={() => setUploading(false)} defaultKind={kind} onUploaded={uploaded} />
    </div>
  );
}
