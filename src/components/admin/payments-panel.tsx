"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, apiFile, saveBlob, type ApiFail } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { randomUuid } from "@/lib/uuid";
import { formatUsd, parseUsdToCents } from "@/modules/payments/service";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "./ui/cn";
import { Dialog } from "./ui/dialog";
import { FieldError, Input, Label } from "./ui/input";
import { ScrollRegion } from "./ui/scroll-region";
import { DataStatus } from "./use-admin-data";

interface PaymentRow {
  id: string;
  universityId: string;
  universityName: string;
  leadId: string | null;
  leadRef: string | null;
  amountUsdCents: number;
  receivedOn: string;
  note: string | null;
  enteredByEmail: string | null;
  enteredAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

interface PaymentsData {
  rows: PaymentRow[];
  truncated: boolean;
  totals: {
    grandTotalCents: number;
    count: number;
    byUniversity: { universityId: string; name: string; totalCents: number; count: number }[];
    byMonth: { month: string; totalCents: number; count: number }[];
  };
  universities: { id: string; name: string }[];
  today: string;
}

interface Filters {
  university: string;
  from: string;
  to: string;
  status: "all" | "active" | "voided";
}

const NO_FILTERS: Filters = { university: "", from: "", to: "", status: "all" };

/** The filters live in the URL, so a view can be bookmarked and the export link carries exactly what the screen shows (B9 step 6). */
export function filtersFromSearch(search: string): Filters {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  return {
    university: params.get("university") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    status: status === "active" || status === "voided" ? status : "all",
  };
}

export function queryOf(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.university) params.set("university", filters.university);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.status !== "all") params.set("status", filters.status);
  const text = params.toString();
  return text ? `?${text}` : "";
}

const newToken = randomUuid;

/** "2026-10" -> "October 2026", in English (the only active locale). Built from the parts so no time zone can move the month. */
function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[Number(number) - 1] ?? month} ${year}`;
}

/** B9: payments received from universities. Record and void only; there is no edit (architecture 7.6). */
export function PaymentsPanel() {
  const t = useTranslations("admin.payments");
  const common = useTranslations("admin.common");
  const id = useId();
  const [applied, setApplied] = useState<Filters | null>(null);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [data, setData] = useState<PaymentsData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "filters">("loading");
  const latest = useRef(0);

  useEffect(() => {
    const read = () => {
      const filters = filtersFromSearch(window.location.search);
      setApplied(filters);
      setDraft(filters);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const load = useCallback(async (filters: Filters) => {
    const mine = ++latest.current;
    setStatus("loading");
    const result = await api<PaymentsData>("GET", `/api/v1/admin/payments${queryOf(filters)}`);
    if (mine !== latest.current) return;
    if (result.ok) {
      setData(result.data);
      setStatus("ready");
    } else if (result.status === 401) window.location.replace("/sign-in");
    else setStatus(result.code === "VALIDATION" ? "filters" : "error");
  }, []);

  useEffect(() => {
    if (applied) void load(applied);
  }, [applied, load]);

  function apply(next: Filters) {
    window.history.pushState(null, "", `${window.location.pathname}${queryOf(next)}`);
    setApplied(next);
  }

  // ---- record -------------------------------------------------------------------------------------------------
  const [recordOpen, setRecordOpen] = useState(false);
  const [token, setToken] = useState(newToken);
  const [university, setUniversity] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [note, setNote] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadChoices, setLeadChoices] = useState<{ id: string; ref: string; name: string }[]>([]);
  const [lead, setLead] = useState<{ id: string; ref: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchSeq = useRef(0);

  function openRecord() {
    setToken(newToken());
    setUniversity("");
    setAmount("");
    setReceivedOn(data?.today ?? "");
    setNote("");
    setLeadQuery("");
    setLeadChoices([]);
    setLead(null);
    setFieldErrors({});
    setFormError(null);
    setRecordOpen(true);
  }

  useEffect(() => {
    const text = leadQuery.trim();
    const mine = ++searchSeq.current;
    if (!recordOpen || lead || text.length < 2) {
      setLeadChoices([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<{ leads: { id: string; ref: string; name: string }[] }>("GET", `/api/v1/admin/payment-leads?q=${encodeURIComponent(text)}`).then((result) => {
        if (mine === searchSeq.current && result.ok) setLeadChoices(result.data.leads);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [leadQuery, lead, recordOpen]);

  function localErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!university) errors.universityId = "REQUIRED";
    if (parseUsdToCents(amount) === null) errors.amount = "INVALID";
    if (!receivedOn) errors.receivedOn = "REQUIRED";
    else if (data && receivedOn > data.today) errors.receivedOn = "FUTURE_DATE";
    return errors;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const errors = localErrors();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    const result = await api("POST", "/api/v1/admin/payments.record", {
      submissionToken: token,
      universityId: university,
      leadId: lead?.id ?? null,
      amount,
      receivedOn,
      note: note.trim() === "" ? null : note,
    });
    setBusy(false);
    if (result.ok) {
      setRecordOpen(false);
      if (applied) void load(applied);
    } else {
      setFieldErrors(result.fields);
      setFormError(formErrorText(result));
    }
  }

  function formErrorText(result: ApiFail): string | null {
    if (result.status === 0) return t("errorNetwork");
    if (result.code === "CONFLICT") return t("errorTokenReused");
    if (result.code === "VALIDATION") return null;
    return t("errorGeneric");
  }

  function fieldText(field: string): string | null {
    const code = fieldErrors[field];
    if (!code) return null;
    return t.has(`fieldErrors.${code}`) ? t(`fieldErrors.${code}`) : t("fieldErrors.INVALID");
  }

  // ---- void ---------------------------------------------------------------------------------------------------
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);

  async function confirmVoid() {
    if (!voiding || busy) return;
    if (reason.trim() === "") {
      setVoidError(t("fieldErrors.REQUIRED"));
      return;
    }
    setBusy(true);
    setVoidError(null);
    const result = await api("POST", "/api/v1/admin/payments.void", { id: voiding.id, reason });
    setBusy(false);
    // Already voided by someone else (409) or gone (404): the list is out of date, so show it again rather than an error.
    if (result.ok || result.status === 409 || result.status === 404) {
      setVoiding(null);
      if (applied) void load(applied);
    } else setVoidError(result.status === 0 ? t("errorNetwork") : t("errorGeneric"));
  }

  // ---- CSV export ---------------------------------------------------------------------------------------------
  // Fetched, not a plain download link: a link would save an error answer (too many rows, a lapsed sign-in) as if it were the file.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    const result = await apiFile(`/api/v1/admin/payments-csv${applied ? queryOf(applied) : ""}`, undefined, "GET");
    setExporting(false);
    if (result.ok) saveBlob(result.data.blob, result.data.filename);
    else setExportError(result.status === 413 ? t("exportTooMany") : t("exportFailed"));
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || status !== "ready"}>
            {t("exportCsv")}
          </Button>
          <Button onClick={openRecord} disabled={status !== "ready"}>
            {t("record")}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>
      {exportError ? <FieldError>{exportError}</FieldError> : null}

      <form
        className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <div>
          <Label htmlFor={`${id}-university`}>{t("filterUniversity")}</Label>
          <select id={`${id}-university`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.university} onChange={(event) => setDraft({ ...draft, university: event.target.value })}>
            <option value="">{t("all")}</option>
            {(data?.universities ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
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
        <div>
          <Label htmlFor={`${id}-status`}>{t("filterStatus")}</Label>
          <select id={`${id}-status`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Filters["status"] })}>
            <option value="all">{t("statusAll")}</option>
            <option value="active">{t("statusActive")}</option>
            <option value="voided">{t("statusVoided")}</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">{t("apply")}</Button>
          <Button variant="ghost" onClick={() => apply(NO_FILTERS)}>
            {t("clear")}
          </Button>
        </div>
      </form>

      {status === "filters" ? <FieldError>{t("errorFilters")}</FieldError> : null}
      <div className="mt-6">
        <DataStatus state={status === "loading" ? { status: "loading" } : status === "error" ? { status: "error", httpStatus: 0 } : { status: "ready", data: null }} reload={() => applied && void load(applied)} />
      </div>

      {status === "ready" && data ? (
        <>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-fg-muted">{t("totalLabel")}</p>
            <p className="text-3xl font-semibold" data-testid="grand-total">
              {t("usd", { amount: formatUsd(data.totals.grandTotalCents) })}
            </p>
            <p className="text-sm text-fg-muted">{t("totalCount", { count: data.totals.count })}</p>
          </div>

          {data.totals.count > 0 ? (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <h2 className="text-lg font-semibold">{t("byUniversity")}</h2>
                <ScrollRegion label={t("byUniversity")} className="mt-2">
                  <table className="w-full text-left">
                    <tbody>
                      {data.totals.byUniversity.map((row) => (
                        <tr key={row.universityId} className="border-b border-border">
                          <td className="py-2 pr-4">{row.name}</td>
                          <td className="py-2 text-right whitespace-nowrap">{t("usd", { amount: formatUsd(row.totalCents) })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              </div>
              <div>
                <h2 className="text-lg font-semibold">{t("byMonth")}</h2>
                <ScrollRegion label={t("byMonth")} className="mt-2">
                  <table className="w-full text-left">
                    <tbody>
                      {data.totals.byMonth.map((row) => (
                        <tr key={row.month} className="border-b border-border">
                          <td className="py-2 pr-4">{monthLabel(row.month)}</td>
                          <td className="py-2 text-right whitespace-nowrap">{t("usd", { amount: formatUsd(row.totalCents) })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              </div>
            </div>
          ) : null}

          <p className="mt-3 text-sm text-fg-muted">{t("totalsNote")}</p>

          <h2 className="mt-8 text-xl font-semibold">{t("listTitle")}</h2>
          {data.rows.length === 0 ? (
            <p className="mt-3 text-fg-muted">{applied && queryOf(applied) ? t("emptyFiltered") : t("empty")}</p>
          ) : (
            <ScrollRegion label={t("listTitle")} className="mt-3">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border text-sm text-fg-muted">
                    <th className="py-2 pr-4">{t("colDate")}</th>
                    <th className="py-2 pr-4">{t("colUniversity")}</th>
                    <th className="py-2 pr-4 text-right">{t("colAmount")}</th>
                    <th className="py-2 pr-4">{t("colLead")}</th>
                    <th className="py-2 pr-4">{t("colBy")}</th>
                    <th className="py-2 pr-4">{t("colStatus")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border align-top" data-voided={row.voidedAt ? "true" : undefined}>
                      <td className={cn("py-2 pr-4 whitespace-nowrap", row.voidedAt && "line-through text-fg-muted")}>{row.receivedOn}</td>
                      <td className={cn("py-2 pr-4", row.voidedAt && "line-through text-fg-muted")}>
                        {row.universityName}
                        {row.note ? <span className="block text-sm text-fg-muted">{row.note}</span> : null}
                      </td>
                      <td className={cn("py-2 pr-4 text-right whitespace-nowrap", row.voidedAt && "line-through text-fg-muted")}>{t("usd", { amount: formatUsd(row.amountUsdCents) })}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {row.leadId && row.leadRef ? (
                          <a href={`/admin/leads/${row.leadId}`} className="underline">
                            {row.leadRef}
                          </a>
                        ) : (
                          <span className="text-fg-muted">{t("noLead")}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 break-all text-sm">
                        {row.enteredByEmail ?? t("formerMember")}
                        <span className="block text-fg-muted">{formatWat(new Date(row.enteredAt))}</span>
                      </td>
                      <td className="py-2 pr-4">
                        {row.voidedAt ? (
                          <>
                            <Badge variant="warning">{t("voided")}</Badge>
                            <span className="block text-sm text-fg-muted">{row.voidReason}</span>
                          </>
                        ) : (
                          <Badge variant="success">{t("recorded")}</Badge>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {row.voidedAt ? null : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setReason("");
                              setVoidError(null);
                              setVoiding(row);
                            }}
                          >
                            {t("void")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          {data.truncated ? <p className="mt-3 text-warning">{t("truncated", { count: data.rows.length })}</p> : null}
        </>
      ) : null}

      <Dialog open={recordOpen} onClose={() => setRecordOpen(false)} title={t("recordTitle")}>
        <form onSubmit={(event) => void save(event)} noValidate>
          <p className="mb-4 text-fg-muted">{t("recordBody")}</p>

          <Label htmlFor={`${id}-r-university`}>{t("fieldUniversity")}</Label>
          <select
            id={`${id}-r-university`}
            className="min-h-11 w-full rounded-md border border-border bg-bg px-3 aria-[invalid=true]:border-danger"
            value={university}
            onChange={(event) => setUniversity(event.target.value)}
            aria-invalid={fieldErrors.universityId ? true : undefined}
            disabled={busy}
          >
            <option value="">{t("choose")}</option>
            {(data?.universities ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          {fieldText("universityId") ? <FieldError>{fieldText("universityId")}</FieldError> : null}

          <div className="mt-4">
            <Label htmlFor={`${id}-r-lead`}>{t("fieldLead")}</Label>
            {lead ? (
              <p className="flex items-center gap-3">
                <strong>{lead.ref}</strong>
                <Button variant="ghost" size="sm" onClick={() => { setLead(null); setLeadQuery(""); }}>
                  {t("removeLead")}
                </Button>
              </p>
            ) : (
              <>
                <Input id={`${id}-r-lead`} value={leadQuery} onChange={(event) => setLeadQuery(event.target.value)} autoComplete="off" placeholder={t("leadPlaceholder")} disabled={busy} />
                {leadChoices.length > 0 ? (
                  <ul className="mt-1 rounded-md border border-border" aria-label={t("fieldLead")}>
                    {leadChoices.map((choice) => (
                      <li key={choice.id}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left hover:bg-surface"
                          onClick={() => {
                            setLead({ id: choice.id, ref: choice.ref });
                            setLeadChoices([]);
                          }}
                        >
                          <span>{choice.name}</span>
                          <span className="text-sm text-fg-muted">{choice.ref}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            {fieldText("leadId") ? <FieldError>{fieldText("leadId")}</FieldError> : null}
          </div>

          <div className="mt-4">
            <Label htmlFor={`${id}-r-amount`}>{t("fieldAmount")}</Label>
            <Input
              id={`${id}-r-amount`}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="1500.00"
              aria-invalid={fieldErrors.amount ? true : undefined}
              disabled={busy}
            />
            {fieldText("amount") ? <FieldError>{fieldText("amount")}</FieldError> : null}
          </div>

          <div className="mt-4">
            <Label htmlFor={`${id}-r-date`}>{t("fieldDate")}</Label>
            <Input
              id={`${id}-r-date`}
              type="date"
              value={receivedOn}
              max={data?.today}
              onChange={(event) => setReceivedOn(event.target.value)}
              aria-invalid={fieldErrors.receivedOn ? true : undefined}
              disabled={busy}
            />
            {fieldText("receivedOn") ? <FieldError>{fieldText("receivedOn")}</FieldError> : null}
          </div>

          <div className="mt-4">
            <Label htmlFor={`${id}-r-note`}>{t("fieldNote")}</Label>
            <Input id={`${id}-r-note`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} autoComplete="off" disabled={busy} />
            {fieldText("note") ? <FieldError>{fieldText("note")}</FieldError> : null}
          </div>

          {formError ? <FieldError>{formError}</FieldError> : null}
          <div className="mt-6 flex gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? common("loading") : t("save")}
            </Button>
            <Button variant="ghost" onClick={() => setRecordOpen(false)}>
              {common("cancel")}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={voiding !== null} onClose={() => setVoiding(null)} title={t("voidTitle")}>
        {voiding ? (
          <div>
            <p className="mb-1 font-semibold">
              {voiding.universityName} · {t("usd", { amount: formatUsd(voiding.amountUsdCents) })} · {voiding.receivedOn}
            </p>
            <p className="mb-4 text-fg-muted">{t("voidBody")}</p>
            <Label htmlFor={`${id}-v-reason`}>{t("voidReason")}</Label>
            <Input id={`${id}-v-reason`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} autoComplete="off" aria-invalid={voidError ? true : undefined} disabled={busy} />
            {voidError ? <FieldError>{voidError}</FieldError> : null}
            <div className="mt-6 flex gap-3">
              <Button variant="destructive" disabled={busy} onClick={() => void confirmVoid()}>
                {t("voidConfirm")}
              </Button>
              <Button variant="ghost" onClick={() => setVoiding(null)}>
                {common("cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
