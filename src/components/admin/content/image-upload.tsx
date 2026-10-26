"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { apiUpload } from "@/lib/client/api";
import { classifyFile, normaliseRedaction, prepareImage, PrepareError, type PreparedImage, type Redaction } from "@/lib/client/image";
import { IMAGE_CAPS, type ImageKind } from "@/lib/image-caps";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FieldError, Input, Label } from "../ui/input";
import { formatBytes } from "./shared";


export interface UploadedMedia {
  id: string;
  sha256: string;
  width: number;
  height: number;
  kind: ImageKind;
  alt: string;
}

interface UploadAnswer {
  id: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  status: "created" | "existing";
}

const KINDS: readonly ImageKind[] = ["photo", "logo", "blog", "testimonial", "other"];

/** The message key for what went wrong while preparing or sending a picture. */
function problemKey(error: unknown): string {
  return error instanceof PrepareError ? error.code : "DECODE_FAILED";
}

/**
 * B6 step 4 and B7 step 2: choose a picture, see it already shrunk and converted to WebP with its size, optionally pixelate the
 * private parts of a document, and upload. The server checks size, file signature and kind again, and stores it under its hash.
 * A picture that is already there is reused (the answer says `existing`).
 */
export function ImageUpload({ open, onClose, defaultKind, onUploaded }: { open: boolean; onClose: () => void; defaultKind: ImageKind; onUploaded: (media: UploadedMedia, existing: boolean) => void }) {
  const t = useTranslations("admin.content.upload");
  const common = useTranslations("admin.common");
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ImageKind>(defaultKind);
  const [alt, setAlt] = useState("");
  const [isDocument, setIsDocument] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [areas, setAreas] = useState<Redaction[]>([]);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setKind(defaultKind);
    setAlt("");
    setIsDocument(false);
    setConfirmed(false);
    setAreas([]);
    setPrepared(null);
    setProblem(null);
  }, [open, defaultKind]);

  // Make the picture again whenever the file, the kind or the pixelated areas change. An older answer never replaces a newer one.
  useEffect(() => {
    if (!file) {
      setPrepared(null);
      return;
    }
    const mine = ++run.current;
    setWorking(true);
    setProblem(null);
    prepareImage(file, kind, areas).then(
      (result) => {
        if (mine !== run.current) return;
        setPrepared(result);
        setWorking(false);
      },
      (error: unknown) => {
        if (mine !== run.current) return;
        setPrepared(null);
        setProblem(problemKey(error));
        setWorking(false);
      },
    );
  }, [file, kind, areas]);

  useEffect(() => {
    if (!prepared) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(prepared.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [prepared]);

  function choose(next: File | null) {
    setAreas([]);
    setConfirmed(false);
    const refused = next ? classifyFile(next) : null;
    if (next && refused) {
      setFile(null);
      setProblem(refused);
      return;
    }
    setFile(next);
  }

  async function send() {
    if (!prepared || sending) return;
    if (isDocument && !confirmed) return;
    setSending(true);
    setProblem(null);
    const params = new URLSearchParams({ kind });
    if (alt.trim()) params.set("alt", alt.trim());
    if (isDocument) {
      params.set("document", "1");
      params.set("confirmed", "1");
    }
    const result = await apiUpload<UploadAnswer>(`/api/v1/admin/media.upload?${params}`, prepared.blob);
    setSending(false);
    if (!result.ok) {
      setProblem(result.status === 0 ? "NETWORK" : result.fields.file ?? (result.code === "TEMPORARILY_UNAVAILABLE" ? "STORAGE" : "SERVER"));
      return;
    }
    onUploaded({ id: result.data.id, sha256: result.data.sha256, width: result.data.width, height: result.data.height, kind, alt: alt.trim() }, result.data.status === "existing");
    onClose();
  }

  const cap = IMAGE_CAPS[kind];
  return (
    <Dialog open={open} onClose={onClose} title={t("title")} className="w-[min(40rem,calc(100vw-2rem))]">
      <div className="space-y-4">
        <div>
          <Label htmlFor={`${id}-file`}>{t("file")}</Label>
          <Input id={`${id}-file`} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
          <p className="mt-1 text-sm text-fg-muted">{t("fileHelp", { cap: formatBytes(cap) })}</p>
        </div>

        <div>
          <Label htmlFor={`${id}-kind`}>{t("kind")}</Label>
          <select id={`${id}-kind`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={kind} onChange={(event) => setKind(event.target.value as ImageKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor={`${id}-alt`}>{t("alt")}</Label>
          <Input id={`${id}-alt`} maxLength={200} value={alt} onChange={(event) => setAlt(event.target.value)} />
          <p className="mt-1 text-sm text-fg-muted">{t("altHelp")}</p>
        </div>

        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-5" checked={isDocument} onChange={(event) => { setIsDocument(event.target.checked); setConfirmed(false); }} />
          <span>{t("isDocument")}</span>
        </label>

        {working ? <p role="status">{t("working")}</p> : null}
        {problem ? <FieldError>{t(`problems.${problem}`)}</FieldError> : null}

        {prepared && previewUrl ? (
          <div>
            <Preview url={previewUrl} width={prepared.width} height={prepared.height} editable={isDocument} onAdd={(area) => setAreas((all) => [...all, area])} label={t("previewLabel")} />
            <p className="mt-1 text-sm" data-testid="prepared-size">
              {t("size", { size: formatBytes(prepared.bytes), cap: formatBytes(cap), width: prepared.width, height: prepared.height })}
            </p>
          </div>
        ) : null}

        {isDocument ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p>{t("blurHelp")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={areas.length === 0} onClick={() => setAreas((all) => all.slice(0, -1))}>
                {t("blurUndo")}
              </Button>
              <Button size="sm" variant="outline" disabled={areas.length === 0} onClick={() => setAreas([])}>
                {t("blurClear")}
              </Button>
              <span className="self-center text-sm text-fg-muted">{t("blurCount", { count: areas.length })}</span>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 size-5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>{t("blurConfirm")}</span>
            </label>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button disabled={!prepared || working || sending || (isDocument && !confirmed)} onClick={() => void send()}>
            {sending ? t("sending") : t("upload")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The prepared picture. For a document, drag on it to mark an area to pixelate. The areas are fractions of the picture. */
function Preview({ url, width, height, editable, onAdd, label }: { url: string; width: number; height: number; editable: boolean; onAdd: (area: Redaction) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  function point(event: React.PointerEvent): { x: number; y: number } {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  return (
    <div
      ref={box}
      className="relative max-w-full select-none overflow-hidden rounded-md border border-border"
      style={{ aspectRatio: `${width} / ${height}`, maxHeight: "50vh", touchAction: editable ? "none" : "auto" }}
      onPointerDown={(event) => {
        if (!editable) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const p = point(event);
        setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const p = point(event);
        setDrag({ ...drag, w: p.x - drag.x, h: p.y - drag.y });
      }}
      onPointerUp={() => {
        if (!drag) return;
        const area = normaliseRedaction(drag);
        setDrag(null);
        if (area) onAdd(area);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of the picture being prepared */}
      <img src={url} alt={label} width={width} height={height} className="size-full object-contain" draggable={false} />
      {drag ? (
        <span className="absolute border-2 border-accent bg-accent/20" style={{ left: `${Math.min(drag.x, drag.x + drag.w) * 100}%`, top: `${Math.min(drag.y, drag.y + drag.h) * 100}%`, width: `${Math.abs(drag.w) * 100}%`, height: `${Math.abs(drag.h) * 100}%` }} />
      ) : null}
    </div>
  );
}
