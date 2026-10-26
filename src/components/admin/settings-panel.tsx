"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { api, apiFile, saveBlob } from "@/lib/client/api";
import { useAdminSession } from "./admin-shell";
import { refreshPublicSite, type Revalidate } from "./content/shared";
import { useStepUp } from "./step-up";
import { Button } from "./ui/button";
import { FieldError, Input, Label } from "./ui/input";
import { DataStatus, useAdminData } from "./use-admin-data";

interface SettingsData {
  values: Record<string, unknown>;
  timezone: string;
  limits: { mediaBudgetMinBytes: number; mediaBudgetMaxBytes: number };
}

const MIB = 1024 * 1024;

/** What the person edits: every value as text, so a half-typed number is never lost and an empty field means "not set" where that is allowed. */
interface Form {
  whatsapp: string;
  phoneDisplay: string;
  slaWeekday: string;
  slaWeekend: string;
  staleFee: string;
  staleTour: string;
  freshness: string;
  budgetMib: string;
  collect: boolean;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? String(value) : "");

export function formFromValues(values: Record<string, unknown>): Form {
  return {
    whatsapp: text(values.whatsapp_number_e164),
    phoneDisplay: text(values.contact_phone_display),
    slaWeekday: num(values.sla_weekday_hours),
    slaWeekend: num(values.sla_weekend_hours),
    staleFee: num(values.stale_fee_days),
    staleTour: num(values.stale_tour_days),
    freshness: num(values.pipeline_freshness_days),
    budgetMib: typeof values.media_budget_bytes === "number" ? String(Math.round(values.media_budget_bytes / MIB)) : "",
    collect: values.collect_page_views !== false,
  };
}

/** A whole number from text, or NaN when it is empty or not one. NaN is sent as-is, so the server names the field. */
const whole = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);

/**
 * Only what changed is sent (C4 step 2). A field the person cleared where "not set" is allowed (pipeline freshness) is sent as null.
 * A value that cannot be read as a number is sent as the original text, so the server's answer, not a guess here, names the problem.
 */
export function changesFrom(values: Record<string, unknown>, form: Form): Record<string, unknown> {
  const before = formFromValues(values);
  const changes: Record<string, unknown> = {};
  const number = (key: string, now: string, was: string) => {
    if (now.trim() === was.trim()) return;
    changes[key] = Number.isNaN(whole(now)) ? now : whole(now);
  };
  if (form.whatsapp.trim() !== before.whatsapp) changes.whatsapp_number_e164 = form.whatsapp.trim();
  if (form.phoneDisplay.trim() !== before.phoneDisplay) changes.contact_phone_display = form.phoneDisplay.trim();
  number("sla_weekday_hours", form.slaWeekday, before.slaWeekday);
  number("sla_weekend_hours", form.slaWeekend, before.slaWeekend);
  number("stale_fee_days", form.staleFee, before.staleFee);
  number("stale_tour_days", form.staleTour, before.staleTour);
  if (form.freshness.trim() !== before.freshness.trim()) changes.pipeline_freshness_days = form.freshness.trim() === "" ? null : Number.isNaN(whole(form.freshness)) ? form.freshness : whole(form.freshness);
  if (form.budgetMib.trim() !== before.budgetMib.trim()) changes.media_budget_bytes = Number.isNaN(whole(form.budgetMib)) ? form.budgetMib : whole(form.budgetMib) * MIB;
  if (form.collect !== before.collect) changes.collect_page_views = form.collect;
  return changes;
}

const FIELD_OF: Record<string, keyof Form> = {
  whatsapp_number_e164: "whatsapp",
  contact_phone_display: "phoneDisplay",
  sla_weekday_hours: "slaWeekday",
  sla_weekend_hours: "slaWeekend",
  stale_fee_days: "staleFee",
  stale_tour_days: "staleTour",
  pipeline_freshness_days: "freshness",
  media_budget_bytes: "budgetMib",
  collect_page_views: "collect",
};

/** C4: the owner's settings. Saving needs a 2FA check inside the last 10 minutes; a change takes effect for what happens afterwards. */
export function SettingsPanel() {
  const t = useTranslations("admin.settings");
  const common = useTranslations("admin.common");
  const session = useAdminSession();
  const stepUp = useStepUp();
  const id = useId();
  const { state, reload } = useAdminData<SettingsData>(session.role === "owner" ? "/api/v1/admin/settings" : null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [message, setMessage] = useState<{ kind: "saved" | "unchanged" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "ready") setForm(formFromValues(state.data.values));
  }, [state]);

  if (session.role !== "owner") return null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || state.status !== "ready" || !form) return;
    const changes = changesFrom(state.data.values, form);
    setErrors({});
    if (Object.keys(changes).length === 0) {
      setMessage({ kind: "unchanged", text: t("nothingToSave") });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await stepUp(() => api<{ changed: string[]; revalidate: Revalidate | null }>("POST", "/api/v1/admin/settings.update", { changes }));
    setBusy(false);
    if (result.ok) {
      const told = await refreshPublicSite(result.data.revalidate);
      setMessage({ kind: "saved", text: result.data.revalidate ? (told ? t("savedSite") : t("savedSiteLater")) : t("saved") });
      reload();
      return;
    }
    if (result.code === "STEP_UP_REQUIRED") setMessage({ kind: "error", text: t("errorStepUp") });
    else if (result.code === "VALIDATION") {
      const next: Partial<Record<keyof Form, string>> = {};
      for (const [path, token] of Object.entries(result.fields)) {
        const field = FIELD_OF[path.replace(/^changes\./, "")];
        if (field) next[field] = token;
      }
      setErrors(next);
      setMessage({ kind: "error", text: t("errorFields") });
    } else setMessage({ kind: "error", text: result.status === 0 ? t("errorNetwork") : t("errorGeneric") });
  }

  async function download() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    const result = await stepUp(() => apiFile("/api/v1/admin/export.download"));
    setExporting(false);
    if (result.ok) saveBlob(result.data.blob, result.data.filename);
    else setExportError(result.code === "STEP_UP_REQUIRED" ? t("errorStepUp") : result.status === 0 ? t("errorNetwork") : t("exportError"));
  }

  function errorText(field: keyof Form): string | null {
    const token = errors[field];
    if (!token) return null;
    return t.has(`fieldErrors.${token}`) ? t(`fieldErrors.${token}`) : t("fieldErrors.INVALID");
  }

  function field(key: keyof Form, label: string, hint: string, props: { inputMode?: "numeric" | "tel" | "text"; maxLength?: number } = {}) {
    const error = errorText(key);
    return (
      <div>
        <Label htmlFor={`${id}-${key}`}>{label}</Label>
        <Input
          id={`${id}-${key}`}
          value={form ? String(form[key]) : ""}
          onChange={(event) => form && setForm({ ...form, [key]: event.target.value })}
          inputMode={props.inputMode ?? "numeric"}
          maxLength={props.maxLength}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-${key}-hint`}
          disabled={busy}
        />
        <p id={`${id}-${key}-hint`} className="mt-1 text-sm text-fg-muted">
          {hint}
        </p>
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>
      <DataStatus state={state} reload={reload} />

      {state.status === "ready" && form ? (
        <form onSubmit={(event) => void save(event)} noValidate className="mt-6 grid max-w-xl gap-6">
          <fieldset className="grid gap-4">
            <legend className="mb-1 text-lg font-semibold">{t("groupContact")}</legend>
            {field("whatsapp", t("whatsapp"), t("whatsappHint"), { inputMode: "tel", maxLength: 20 })}
            {field("phoneDisplay", t("phoneDisplay"), t("phoneDisplayHint"), { inputMode: "tel", maxLength: 40 })}
          </fieldset>

          <fieldset className="grid gap-4">
            <legend className="mb-1 text-lg font-semibold">{t("groupLeads")}</legend>
            {field("slaWeekday", t("slaWeekday"), t("slaHint"))}
            {field("slaWeekend", t("slaWeekend"), t("slaHint"))}
            {field("freshness", t("freshness"), t("freshnessHint"))}
          </fieldset>

          <fieldset className="grid gap-4">
            <legend className="mb-1 text-lg font-semibold">{t("groupContent")}</legend>
            {field("staleFee", t("staleFee"), t("staleHint"))}
            {field("staleTour", t("staleTour"), t("staleHint"))}
            {field("budgetMib", t("budget"), t("budgetHint", { min: Math.round(state.data.limits.mediaBudgetMinBytes / MIB), max: Math.round(state.data.limits.mediaBudgetMaxBytes / MIB) }))}
          </fieldset>

          <fieldset className="grid gap-4">
            <legend className="mb-1 text-lg font-semibold">{t("groupAnalytics")}</legend>
            <div className="flex items-start gap-3">
              <input
                id={`${id}-collect`}
                type="checkbox"
                className="mt-1 size-5"
                checked={form.collect}
                onChange={(event) => setForm({ ...form, collect: event.target.checked })}
                aria-describedby={`${id}-collect-hint`}
                disabled={busy}
              />
              <div>
                <Label htmlFor={`${id}-collect`} className="mb-0">
                  {t("collect")}
                </Label>
                <p id={`${id}-collect-hint`} className="text-sm text-fg-muted">
                  {t("collectHint")}
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold">{t("timezone")}</p>
              <p className="text-fg-muted">{t("timezoneValue", { zone: state.data.timezone })}</p>
            </div>
          </fieldset>

          <p className="text-sm text-fg-muted">{t("futureOnly")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? common("loading") : t("save")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setForm(formFromValues(state.data.values)); setErrors({}); setMessage(null); }}>
              {t("reset")}
            </Button>
          </div>
          {message ? (
            <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-danger" : message.kind === "saved" ? "text-success" : "text-fg-muted"}>
              {message.text}
            </p>
          ) : null}
        </form>
      ) : null}

      {state.status === "ready" ? (
        <div className="mt-10 max-w-xl border-t border-border pt-6">
          <h2 className="text-xl font-semibold">{t("exportTitle")}</h2>
          <p className="mt-2 text-fg-muted">{t("exportBody")}</p>
          <Button className="mt-4" variant="outline" disabled={exporting} onClick={() => void download()}>
            {exporting ? common("loading") : t("exportButton")}
          </Button>
          {exportError ? <FieldError>{exportError}</FieldError> : null}
        </div>
      ) : null}
    </section>
  );
}
