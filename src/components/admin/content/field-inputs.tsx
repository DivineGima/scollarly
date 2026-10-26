"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MarkdownView } from "@/components/public/markdown-view";
import { type FieldDef, KNOWN_COPY_KEYS } from "@/modules/content-admin/definitions";
import type { ImageKind } from "@/lib/image-caps";
import { Button } from "../ui/button";
import { FieldError, Input, Label } from "../ui/input";
import { MediaPicker, type MediaOption } from "./media-picker";

export type RawValue = string | boolean;
export type Raw = Record<string, RawValue>;

export interface Options {
  universities: { id: string; name: string }[];
  programmes: { id: string; name: string; universityId: string }[];
  consents: { id: string; subjectName: string; scope: string; grantedOn: string; revoked: boolean }[];
  stages: { code: string; name: string }[];
  media: MediaOption[];
}

const SELECT = "min-h-11 w-full rounded-md border border-border bg-bg px-3 aria-[invalid=true]:border-danger focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent";
const AREA = "min-h-32 w-full rounded-md border border-border bg-bg p-3 text-base aria-[invalid=true]:border-danger focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The form's text for a value: the stored value becomes a string for an input, and the input's string becomes the value on save. */
export function toRaw(def: { fields: readonly FieldDef[] }, values: Record<string, unknown>): Raw {
  const raw: Raw = {};
  for (const field of def.fields) {
    const v = values[field.key];
    raw[field.key] = field.kind === "boolean" ? v === true : v === null || v === undefined ? "" : String(v);
  }
  return raw;
}

export function toPayload(def: { fields: readonly FieldDef[] }, raw: Raw): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of def.fields) {
    const v = raw[field.key];
    if (field.kind === "boolean") out[field.key] = v === true;
    else if (field.kind === "number" || field.kind === "money") {
      const text = String(v ?? "").trim();
      const n = Number(text);
      out[field.key] = text === "" ? null : Number.isNaN(n) ? text : n;
    } else out[field.key] = String(v ?? "");
  }
  return out;
}

/** A URL piece for a name: lower case, letters and digits, single hyphens. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface FieldProps {
  field: FieldDef;
  idBase: string;
  raw: Raw;
  options: Options;
  error: string | undefined;
  /** An existing item's fixed fields (slug, key) cannot be edited. */
  locked: boolean;
  onChange: (key: string, value: RawValue) => void;
  onBlur: (key: string) => void;
  onMediaUploaded: (media: MediaOption) => void;
  /** The consent field's extra buttons (add, revoke), supplied by the form. */
  extra?: React.ReactNode;
}

/** One field of a content form, by kind. The label, help and error text come from the messages; the error is a token (FR-15). */
export function FieldInput(props: FieldProps) {
  const { field, idBase, raw, options, error, locked, onChange, onBlur } = props;
  const t = useTranslations("admin.content");
  const id = `${idBase}-${field.key}`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const value = raw[field.key];
  const text = typeof value === "string" ? value : "";
  const help = t.has(`help.${field.key}`) ? t(`help.${field.key}`) : null;
  const invalid = error !== undefined;
  const aria = { "aria-invalid": invalid ? true : undefined, "aria-describedby": [invalid ? errorId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined };
  const label = (
    <Label htmlFor={id}>
      {t(`fields.${field.key}`)}
      {field.required ? <span aria-hidden="true"> *</span> : null}
    </Label>
  );
  const footer = (
    <>
      {help ? (
        <p id={helpId} className="mt-1 text-sm text-fg-muted">
          {help}
        </p>
      ) : null}
      {invalid ? <FieldError id={errorId}>{t(`tokens.${error}` as "tokens.INVALID")}</FieldError> : null}
    </>
  );
  const optionLabel = (v: string) => (t.has(`options.${field.key}.${v}`) ? t(`options.${field.key}.${v}`) : v);

  switch (field.kind) {
    case "boolean":
      return (
        <div>
          <label className="flex min-h-11 items-center gap-2">
            <input id={id} type="checkbox" className="size-5" checked={value === true} onChange={(event) => onChange(field.key, event.target.checked)} onBlur={() => onBlur(field.key)} {...aria} />
            <span className="font-semibold">{t(`fields.${field.key}`)}</span>
          </label>
          {footer}
        </div>
      );
    case "textarea":
      return (
        <div>
          {label}
          <textarea id={id} className={AREA} maxLength={field.max} value={text} onChange={(event) => onChange(field.key, event.target.value)} onBlur={() => onBlur(field.key)} {...aria} />
          {footer}
        </div>
      );
    case "markdown":
      return <MarkdownField {...props} id={id} text={text} label={label} footer={footer} aria={aria} />;
    case "select":
      return (
        <div>
          {label}
          <select id={id} className={SELECT} value={text} onChange={(event) => onChange(field.key, event.target.value)} onBlur={() => onBlur(field.key)} {...aria}>
            <option value="">{t("choose")}</option>
            {(field.options ?? []).map((v) => (
              <option key={v} value={v}>
                {optionLabel(v)}
              </option>
            ))}
          </select>
          {footer}
        </div>
      );
    case "ref":
      return <RefField {...props} id={id} text={text} label={label} footer={footer} aria={aria} />;
    case "media":
      return (
        <div>
          <Label htmlFor={id}>{t(`fields.${field.key}`)}</Label>
          <MediaPicker
            id={id}
            value={text || null}
            options={options.media}
            kind={(field.mediaKind ?? "photo") as ImageKind}
            onChange={(v) => onChange(field.key, v ?? "")}
            onUploaded={props.onMediaUploaded}
            invalid={invalid}
            {...(aria["aria-describedby"] ? { describedBy: aria["aria-describedby"] } : {})}
          />
          {footer}
        </div>
      );
    default: {
      // text, slug, url, number, money, date, youtube. A key with a list of known names offers them.
      const isKey = field.key === "key" && field.kind === "text";
      return (
        <div>
          {label}
          <Input
            id={id}
            list={isKey && !locked ? `${id}-known` : undefined}
            type={field.kind === "url" ? "url" : field.kind === "date" ? "date" : "text"}
            inputMode={field.kind === "number" ? "numeric" : field.kind === "money" ? "decimal" : undefined}
            maxLength={field.max && field.kind !== "number" && field.kind !== "money" ? field.max : undefined}
            readOnly={locked}
            autoCapitalize={field.kind === "slug" || field.kind === "url" || isKey ? "none" : undefined}
            spellCheck={field.kind === "text" ? undefined : false}
            value={text}
            onChange={(event) => onChange(field.key, event.target.value)}
            onBlur={() => onBlur(field.key)}
            {...aria}
          />
          {isKey && !locked ? (
            <datalist id={`${id}-known`}>
              {KNOWN_COPY_KEYS.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          ) : null}
          {footer}
        </div>
      );
    }
  }
}

type Inner = FieldProps & { id: string; text: string; label: React.ReactNode; footer: React.ReactNode; aria: Record<string, string | boolean | undefined> };

function RefField({ field, options, raw, onChange, onBlur, id, text, label, footer, aria, extra }: Inner) {
  const t = useTranslations("admin.content");
  let choices: { value: string; label: string }[] = [];
  if (field.ref === "university") choices = options.universities.map((u) => ({ value: u.id, label: u.name }));
  else if (field.ref === "programme") {
    const university = String(raw.universityId ?? "");
    choices = options.programmes.filter((p) => !university || p.universityId === university).map((p) => ({ value: p.id, label: p.name }));
  } else if (field.ref === "stage") choices = options.stages.map((s) => ({ value: s.code, label: s.name }));
  else if (field.ref === "consent") {
    choices = options.consents
      .filter((c) => c.scope === field.consentScope && (!c.revoked || c.id === text))
      .map((c) => ({ value: c.id, label: `${c.subjectName} · ${c.grantedOn}${c.revoked ? ` · ${t("consent.revokedMark")}` : ""}` }));
  }
  return (
    <div>
      {label}
      <select id={id} className={SELECT} value={text} onChange={(event) => onChange(field.key, event.target.value)} onBlur={() => onBlur(field.key)} {...aria}>
        <option value="">{t("choose")}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      {extra}
      {footer}
    </div>
  );
}

/** The blog body: a text box and a preview made with the same sanitiser the public page uses (B6 per-content: Blog). */
function MarkdownField({ field, onChange, onBlur, id, text, label, footer, aria }: Inner) {
  const t = useTranslations("admin.content");
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        {label}
        <Button size="sm" variant="outline" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          {preview ? t("markdown.edit") : t("markdown.preview")}
        </Button>
      </div>
      {preview ? (
        <div className="min-h-32 rounded-md border border-border p-3" data-testid="markdown-preview">
          {text.trim() ? <MarkdownView source={text} /> : <p className="text-fg-muted">{t("markdown.empty")}</p>}
        </div>
      ) : (
        <textarea id={id} className={`${AREA} min-h-64 font-mono text-sm`} maxLength={field.max} value={text} onChange={(event) => onChange(field.key, event.target.value)} onBlur={() => onBlur(field.key)} {...aria} />
      )}
      {footer}
    </div>
  );
}
