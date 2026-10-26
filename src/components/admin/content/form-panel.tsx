"use client";

 

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { type ContentTypeKey, type FieldDef, type JourneyStepInput, TYPE_DEFS } from "@/modules/content-admin/definitions";
import { publishIssues, valuesSchema } from "@/modules/content-admin/schema";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { FieldError, Input, Label } from "../ui/input";
import { DataStatus, useAdminData } from "../use-admin-data";
import { FieldInput, type Options, type Raw, type RawValue, slugify, toPayload, toRaw } from "./field-inputs";
import type { MediaOption } from "./media-picker";
import { contentRoute, failureKey, refreshPublicSite, type Revalidate, type Status, StatusBadge, UUID } from "./shared";

interface ItemData {
  type: ContentTypeKey;
  item: { id: string; status: Status; version: string; values: Record<string, unknown>; steps: JourneyStepInput[]; consentRevoked: boolean; slug: string | null } | null;
  options: Options;
}

interface SaveAnswer {
  id: string;
  version: string;
  status: Status;
  revalidate: Revalidate | null;
}

type Banner = { kind: "ok" | "warn" | "error"; text: string; retry?: () => void; reload?: boolean; link?: { href: string; label: string } } | null;
type Pending = null | "publish" | "unpublish" | "archive" | "restore" | "revoke";

const FLASH = "scollarly.content.flash";

/** B6: the edit screen of one item (or an empty one at `/new`), for every content type. */
export function ContentForm() {
  const t = useTranslations("admin.content");
  const [route, setRoute] = useState<{ type: ContentTypeKey | null; id: string | null } | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => setRoute(contentRoute(window.location.pathname)), []);
  const path = route?.type && route.id !== null && (route.id === "new" || UUID.test(route.id)) ? `/api/v1/admin/content-item?type=${route.type}${route.id === "new" ? "" : `&id=${route.id}`}` : null;
  const { state, reload } = useAdminData<ItemData>(path);

  if (route === undefined) return null;
  if (!route.type || path === null) return <p role="alert">{t("unknownType")}</p>;
  if (state.status === "error" && state.httpStatus === 404) return <p role="alert">{t("errors.notFound")}</p>;
  if (state.status !== "ready") return <DataStatus state={state} reload={reload} />;
  return (
    <Editor
      key={`${state.data.item?.id ?? "new"}-${nonce}`}
      data={state.data}
      reload={() => {
        setNonce((n) => n + 1);
        reload();
      }}
    />
  );
}

function Editor({ data, reload }: { data: ItemData; reload: () => void }) {
  const t = useTranslations("admin.content");
  const common = useTranslations("admin.common");
  const idBase = useId();
  const def = TYPE_DEFS[data.type];
  const [item, setItem] = useState(data.item);
  const [raw, setRaw] = useState<Raw>(() => toRaw(def, data.item?.values ?? {}));
  const [steps, setSteps] = useState<JourneyStepInput[]>(() => data.item?.steps ?? []);
  const [options, setOptions] = useState<Options>(data.options);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stepError, setStepError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const baseline = useRef(JSON.stringify({ raw: toRaw(def, data.item?.values ?? {}), steps: data.item?.steps ?? [] }));
  const slugTouched = useRef(item !== null);
  const leaving = useRef(false);
  const schema = useMemo(() => valuesSchema(def), [def]);

  const dirty = JSON.stringify({ raw, steps }) !== baseline.current;
  const status: Status = item?.status ?? "draft";
  const readOnly = status === "archived";

  // Step 9: leaving with unsaved changes asks the browser to confirm.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      // The save that created the item moves to its own address on purpose; that is not leaving with something to lose.
      if (leaving.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  // A flash left by the save that created this item (the page was replaced with the item's own address).
  useEffect(() => {
    try {
      const flash = window.sessionStorage.getItem(FLASH);
      if (flash) {
        window.sessionStorage.removeItem(FLASH);
        setBanner({ kind: "ok", text: t("saved") });
      }
    } catch {
      // Storage can be blocked; the banner is a nicety.
    }
  }, [t]);

  const payload = useCallback(() => toPayload(def, raw), [def, raw]);

  function setField(key: string, value: RawValue) {
    setRaw((current) => {
      const next = { ...current, [key]: value };
      // A new item's address follows its name until the person edits the address themselves.
      if (!slugTouched.current && def.fields.some((f) => f.key === "slug") && (key === "name" || key === "title") && typeof value === "string") next.slug = slugify(value);
      if (key === "slug") slugTouched.current = true;
      // A fee's programme must belong to its university.
      if (key === "universityId" && def.fields.some((f) => f.key === "programmeId")) next.programmeId = "";
      return next;
    });
    setErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _gone, ...rest } = current;
      void _gone;
      return rest;
    });
  }

  function blur(key: string) {
    const result = schema.safeParse(payload());
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === key);
    if (issue) setErrors((current) => ({ ...current, [key]: issue.message }));
  }

  /** Runs the form's own check (the same Zod definition as the server). Returns false and shows the errors when something is wrong. */
  function validate(): boolean {
    const result = schema.safeParse(payload());
    const found: Record<string, string> = {};
    if (!result.success) for (const issue of result.error.issues) if (typeof issue.path[0] === "string" && !(issue.path[0] in found)) found[issue.path[0]] = issue.message;
    const badStep = def.steps ? steps.findIndex((s) => !s.title.trim() || !s.body.trim()) : -1;
    setStepError(badStep >= 0 ? "REQUIRED" : null);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = Object.keys(found)[0];
      document.getElementById(`${idBase}-${first}`)?.focus();
    }
    return Object.keys(found).length === 0 && badStep < 0;
  }

  function applyServerErrors(fields: Record<string, string>) {
    const mine: Record<string, string> = {};
    for (const [key, token] of Object.entries(fields)) {
      if (key.startsWith("values.")) mine[key.slice("values.".length)] = token;
      else if (key === "steps") setStepError(token);
      else if (key === "form") setBanner({ kind: "error", text: t(`tokens.${token}` as "tokens.INVALID") });
    }
    setErrors(mine);
    const first = Object.keys(mine)[0];
    if (first) document.getElementById(`${idBase}-${first}`)?.focus();
  }

  async function afterChange(answer: SaveAnswer, message: string, link?: { href: string; label: string }) {
    const told = await refreshPublicSite(answer.revalidate);
    setBanner({ kind: told ? "ok" : "warn", text: told ? message : `${message} ${t("done.siteSlow")}`, ...(link ? { link } : {}) });
  }

  const viewLink = useCallback(
    (slug: string | null): { href: string; label: string } | undefined => {
      if (def.publicPath && slug) return { href: `${def.publicPath.prefix}/${slug}`, label: t("viewOnSite") };
      const page = def.pages[0];
      return page ? { href: page, label: t("viewOnSite") } : undefined;
    },
    [def, t],
  );

  async function save(): Promise<boolean> {
    if (busy || readOnly) return false;
    if (!validate()) {
      setBanner({ kind: "error", text: t("fixErrors") });
      return false;
    }
    setBusy(true);
    setBanner(null);
    const body = { type: data.type, ...(item ? { id: item.id, version: item.version } : {}), values: payload(), ...(def.steps ? { steps } : {}) };
    const result = await api<SaveAnswer>("POST", "/api/v1/admin/content.save", body);
    setBusy(false);
    if (!result.ok) {
      if (result.code === "VALIDATION") {
        applyServerErrors(result.fields);
        setBanner((b) => b ?? { kind: "error", text: t("fixErrors") });
      } else setBanner({ kind: "error", text: t(`errors.${failureKey(result)}`), ...(result.status === 0 ? { retry: () => void save() } : {}), ...(failureKey(result) === "stale" ? { reload: true } : {}) });
      return false;
    }
    if (!item) {
      try {
        window.sessionStorage.setItem(FLASH, "1");
      } catch {
        // Storage can be blocked; the new address is what matters.
      }
      baseline.current = JSON.stringify({ raw, steps });
      leaving.current = true;
      window.location.replace(`/admin/content/${data.type}/${result.data.id}`);
      return true;
    }
    baseline.current = JSON.stringify({ raw, steps });
    setItem({ ...item, version: result.data.version, status: result.data.status, steps: [...steps] });
    setErrors({});
    await afterChange(result.data, result.data.status === "published" ? t("savedLive") : t("saved"), result.data.status === "published" ? viewLink(item.slug) : undefined);
    return true;
  }

  async function change(action: "publish" | "unpublish" | "archive" | "restore") {
    if (!item || busy) return;
    setBusy(true);
    const result = await api<SaveAnswer>("POST", `/api/v1/admin/content.${action}`, { type: data.type, id: item.id, version: item.version });
    setBusy(false);
    setPending(null);
    if (!result.ok) {
      if (result.code === "VALIDATION") {
        applyServerErrors(result.fields);
        setBanner({ kind: "error", text: t("gate.refused") });
      } else setBanner({ kind: "error", text: t(`errors.${failureKey(result)}`), ...(result.status === 0 ? { retry: () => void change(action) } : {}), ...(failureKey(result) === "stale" ? { reload: true } : {}) });
      return;
    }
    setItem({ ...item, version: result.data.version, status: result.data.status });
    await afterChange(result.data, t(`done.${action}`), action === "publish" ? viewLink(item.slug) : undefined);
  }

  async function revokeConsent() {
    const consentId = String(raw.consentId ?? "");
    if (!consentId || busy) return;
    setBusy(true);
    const result = await api<{ unpublished: number; revalidate: Revalidate }>("POST", "/api/v1/admin/consent.revoke", { id: consentId });
    setBusy(false);
    setPending(null);
    if (!result.ok) {
      setBanner({ kind: "error", text: t(`errors.${failureKey(result)}`), ...(failureKey(result) !== "network" ? { reload: true } : {}) });
      return;
    }
    await refreshPublicSite(result.data.revalidate);
    setBanner({ kind: "ok", text: t("consent.revoked", { count: result.data.unpublished }), reload: true });
  }

  const issues = item ? publishIssues(def, payload(), { consentRevoked: item.consentRevoked || options.consents.some((c) => c.id === raw.consentId && c.revoked) }) : {};
  const locked = (f: FieldDef) => Boolean(f.immutable && item);
  const consentField = def.fields.find((f) => f.kind === "ref" && f.ref === "consent");
  const selectedConsent = consentField ? options.consents.find((c) => c.id === raw[consentField.key]) : undefined;

  return (
    <section>
      <p>
        <a href={`/admin/content/${data.type}`} className="underline">
          {t("backTo", { name: t(`types.${data.type}.name`) })}
        </a>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{item ? t("editTitle", { name: t(`types.${data.type}.one`) }) : t("newTitle", { name: t(`types.${data.type}.one`) })}</h1>
        {item ? <StatusBadge status={status} /> : null}
      </div>

      {banner ? (
        <div role={banner.kind === "error" ? "alert" : "status"} className={cn("mt-4 flex flex-wrap items-center gap-3 rounded-md border p-3", banner.kind === "ok" ? "border-success text-success" : banner.kind === "warn" ? "border-warning text-warning" : "border-danger text-danger")}>
          <span>{banner.text}</span>
          {banner.link ? (
            <a href={banner.link.href} className="font-semibold underline" target="_blank" rel="noopener">
              {banner.link.label}
            </a>
          ) : null}
          {banner.retry ? (
            <Button size="sm" variant="outline" onClick={banner.retry}>
              {common("retry")}
            </Button>
          ) : null}
          {banner.reload ? (
            <Button size="sm" variant="outline" onClick={reload}>
              {t("reload")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {readOnly ? (
        <p className="mt-4 rounded-md border border-border p-3" role="status">
          {t("archivedNotice")}
        </p>
      ) : null}

      <form
        className="mt-6 space-y-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={readOnly} className="space-y-5">
          <legend className="sr-only">{t(`types.${data.type}.name`)}</legend>
          {def.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              idBase={idBase}
              raw={raw}
              options={options}
              error={errors[field.key]}
              locked={locked(field)}
              onChange={setField}
              onBlur={blur}
              onMediaUploaded={(media: MediaOption) => setOptions((o) => ({ ...o, media: [media, ...o.media.filter((m) => m.id !== media.id)] }))}
              extra={
                field === consentField ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setConsentOpen(true)}>
                      {t("consent.add")}
                    </Button>
                    {item && selectedConsent && !selectedConsent.revoked ? (
                      <Button size="sm" variant="outline" onClick={() => setPending("revoke")}>
                        {t("consent.revoke")}
                      </Button>
                    ) : null}
                  </div>
                ) : undefined
              }
            />
          ))}

          {def.steps ? <StepsEditor steps={steps} onChange={setSteps} fixed={item?.steps.length ?? 0} error={stepError} /> : null}
        </fieldset>

        {/* Steps 2, 5, 6: the bar is always in reach; "Publish" waits until what is on screen is saved. */}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-bg px-4 py-3">
          {!readOnly ? (
            <Button type="submit" disabled={busy || (item !== null && !dirty)}>
              {busy ? t("saving") : status === "published" ? t("saveChanges") : t("saveDraft")}
            </Button>
          ) : null}
          {item && status === "draft" ? (
            <Button variant="outline" disabled={busy || dirty} onClick={() => setPending("publish")} title={dirty ? t("saveFirst") : undefined}>
              {t("actions.publish")}
            </Button>
          ) : null}
          {!item ? (
            <Button variant="outline" disabled aria-disabled="true" title={t("saveFirst")}>
              {t("actions.publish")}
            </Button>
          ) : null}
          {item && status === "published" ? (
            <Button variant="outline" disabled={busy} onClick={() => setPending("unpublish")}>
              {t("actions.unpublish")}
            </Button>
          ) : null}
          {item && status !== "archived" ? (
            <Button variant="outline" disabled={busy} onClick={() => setPending("archive")}>
              {t("actions.archive")}
            </Button>
          ) : null}
          {item && status === "archived" ? (
            <Button variant="outline" disabled={busy} onClick={() => setPending("restore")}>
              {t("actions.restore")}
            </Button>
          ) : null}
          <a href={`/admin/content/${data.type}`} className={buttonVariants({ variant: "ghost" })}>
            {common("cancel")}
          </a>
          {dirty ? <span className="text-sm text-fg-muted">{t("unsaved")}</span> : null}
        </div>
      </form>

      {/* Step 6: the dialog lists the gates, and Publish stays off until each is met. */}
      <Dialog open={pending === "publish"} onClose={() => setPending(null)} title={t("gate.title")}>
        {Object.keys(issues).length > 0 ? (
          <>
            <p>{t("gate.missing")}</p>
            <ul className="mt-2 list-disc pl-5" data-testid="gate-list">
              {Object.entries(issues).map(([key, token]) => (
                <li key={key}>
                  {t(`fields.${key}` as "fields.name")}: {t(`tokens.${token}` as "tokens.INVALID")}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{t("gate.ready")}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPending(null)}>
            {common("cancel")}
          </Button>
          <Button disabled={busy || Object.keys(issues).length > 0} onClick={() => void change("publish")}>
            {t("actions.publish")}
          </Button>
        </div>
      </Dialog>

      {(["unpublish", "archive", "restore"] as const).map((action) => (
        <Dialog key={action} open={pending === action} onClose={() => setPending(null)} title={t(`confirm.${action}.title`)}>
          <p>{t(`confirm.${action}.body`)}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)}>
              {common("cancel")}
            </Button>
            <Button variant={action === "restore" ? "default" : "destructive"} disabled={busy} onClick={() => void change(action)}>
              {t(`actions.${action}`)}
            </Button>
          </div>
        </Dialog>
      ))}

      <Dialog open={pending === "revoke"} onClose={() => setPending(null)} title={t("consent.revokeTitle")}>
        <p>{t("consent.revokeBody")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPending(null)}>
            {common("cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void revokeConsent()}>
            {t("consent.revoke")}
          </Button>
        </div>
      </Dialog>

      {consentField?.consentScope ? (
        <ConsentDialog
          open={consentOpen}
          onClose={() => setConsentOpen(false)}
          scope={consentField.consentScope}
          defaultName={String(raw.studentName ?? "")}
          onCreated={(consent) => {
            setOptions((o) => ({ ...o, consents: [consent, ...o.consents] }));
            setField(consentField.key, consent.id);
            setConsentOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

/** Journey steps: add and edit; a step that is already saved cannot be removed (no physical deletes, ADR-029). */
function StepsEditor({ steps, onChange, fixed, error }: { steps: JourneyStepInput[]; onChange: (steps: JourneyStepInput[]) => void; fixed: number; error: string | null }) {
  const t = useTranslations("admin.content.steps");
  const id = useId();
  const set = (index: number, patch: Partial<JourneyStepInput>) => onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  return (
    <div>
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t("help")}</p>
      <ol className="mt-3 space-y-4">
        {steps.map((step, index) => (
          <li key={index} className="space-y-2 rounded-md border border-border p-3">
            <p className="font-semibold">{t("step", { number: index + 1 })}</p>
            <div>
              <Label htmlFor={`${id}-${index}-title`}>{t("stepTitle")}</Label>
              <Input id={`${id}-${index}-title`} maxLength={200} value={step.title} onChange={(event) => set(index, { title: event.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${id}-${index}-body`}>{t("stepBody")}</Label>
              <textarea id={`${id}-${index}-body`} className="min-h-24 w-full rounded-md border border-border bg-bg p-3" maxLength={2000} value={step.body} onChange={(event) => set(index, { body: event.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${id}-${index}-date`}>{t("stepDate")}</Label>
              <Input id={`${id}-${index}-date`} maxLength={60} value={step.dateLabel ?? ""} onChange={(event) => set(index, { dateLabel: event.target.value })} />
            </div>
            {index >= fixed ? (
              <Button size="sm" variant="outline" onClick={() => onChange(steps.filter((_, i) => i !== index))}>
                {t("removeNew")}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      {error ? <FieldError>{t(`errors.${error}` as "errors.REQUIRED")}</FieldError> : null}
      <Button className="mt-3" variant="outline" disabled={steps.length >= 30} onClick={() => onChange([...steps, { title: "", body: "", dateLabel: null }])}>
        {t("add")}
      </Button>
    </div>
  );
}

/** B6 per-content: "Add consent record" opens this small form (who, scope, how consent was obtained, date). */
function ConsentDialog({ open, onClose, scope, defaultName, onCreated }: { open: boolean; onClose: () => void; scope: string; defaultName: string; onCreated: (consent: Options["consents"][number]) => void }) {
  const t = useTranslations("admin.content.consent");
  const common = useTranslations("admin.common");
  const id = useId();
  const [name, setName] = useState(defaultName);
  const [evidence, setEvidence] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setEvidence("");
      setError(null);
    }
  }, [open, defaultName]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || !evidence.trim()) {
      setError("REQUIRED");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api<{ id: string }>("POST", "/api/v1/admin/consent.create", { subjectName: name.trim(), scope, evidenceNote: evidence.trim(), grantedOn: date });
    setBusy(false);
    if (!result.ok) {
      setError(result.status === 0 ? "NETWORK" : "GENERIC");
      return;
    }
    onCreated({ id: result.data.id, subjectName: name.trim(), scope, grantedOn: date, revoked: false });
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("title")}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <Label htmlFor={`${id}-name`}>{t("who")}</Label>
          <Input id={`${id}-name`} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-evidence`}>{t("how")}</Label>
          <textarea id={`${id}-evidence`} className="min-h-24 w-full rounded-md border border-border bg-bg p-3" maxLength={1000} value={evidence} onChange={(event) => setEvidence(event.target.value)} />
          <p className="mt-1 text-sm text-fg-muted">{t("howHelp")}</p>
        </div>
        <div>
          <Label htmlFor={`${id}-date`}>{t("when")}</Label>
          <Input id={`${id}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {error ? <FieldError>{t(`errors.${error}` as "errors.REQUIRED")}</FieldError> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
