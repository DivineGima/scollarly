"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFullPayload, fillTemplate, validateFull, type FieldErrors, type FullValues } from "@/lib/lead-form";
import { listLeads, removeLead } from "@/offline/lead-queue";
import { displayState, type QueuedLead } from "@/offline/logic";
import { realSyncDeps } from "@/offline/real-deps";
import { syncOnce } from "@/offline/sync-engine";
import { errorText, type LeadLabels, type ProgrammeOption } from "./labels";
import { ConsentField, CountrySelect, describedBy, detailsTextOf, Field, FlowResult, TurnstileBox } from "./lead-parts";
import { useLeadFlow } from "./use-lead-flow";

const EMPTY: FullValues = { name: "", country: "", whatsapp: "", consent: false, qualification: "", results: [], programmeIds: [], email: "" };
const MAX_RESULT_ROWS = 30;

/**
 * Start your application (architecture 16 A5), the full form. It is a client island on a prerendered page: the page and the
 * programme list are in the HTML; this code makes the form work, offline included. Continue saves the lead on the phone
 * first, sends it, waits up to four seconds, then opens WhatsApp with the reference (ADR-031).
 */
export function ApplyForm({
  labels,
  programmes,
  numberE164,
  siteKey,
  locale,
}: {
  labels: LeadLabels;
  programmes: ProgrammeOption[];
  numberE164: string | null;
  siteKey: string;
  locale: string;
}) {
  const [values, setValues] = useState<FullValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [query, setQuery] = useState("");
  const [universityId, setUniversityId] = useState<string | undefined>();
  const flow = useLeadFlow({ siteKey, numberE164 });
  const [queue, setQueue] = useState<QueuedLead[]>([]);
  const [online, setOnline] = useState(true);
  const submittedRef = useRef(false);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await listLeads());
    } catch {
      setQueue([]);
    }
  }, []);

  // Opening /apply starts a sync (architecture 11.2) and shows what is still on the phone.
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => {
      setOnline(true);
      void runSync();
    };
    const off = () => setOnline(false);
    async function runSync() {
      try {
        await syncOnce(realSyncDeps({ siteKey, host: () => flow.hostRef.current, onInteractive: () => undefined }, () => void refreshQueue()));
      } finally {
        await refreshQueue();
      }
    }
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void refreshQueue().then(() => (navigator.onLine ? runSync() : undefined));
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
    // The refs and callbacks are stable; the sync should start once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `?university=<id>` (from a university page) and `?programme=<id>` pre-select what the student was looking at.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const university = params.get("university") || undefined;
    const programme = params.get("programme");
    setUniversityId(university);
    if (programme && programmes.some((p) => p.id === programme)) setValues((v) => (v.programmeIds.includes(programme) ? v : { ...v, programmeIds: [programme] }));
  }, [programmes]);

  const byId = useMemo(() => new Map(programmes.map((p) => [p.id, p])), [programmes]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return programmes
      .filter((p) => !values.programmeIds.includes(p.id))
      .filter((p) => (universityId && !needle ? p.universityId === universityId : true))
      .filter((p) => !needle || `${p.name} ${p.universityName}`.toLowerCase().includes(needle))
      .slice(0, 30);
  }, [programmes, query, values.programmeIds, universityId]);

  const set = <K extends keyof FullValues>(key: K, value: FullValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const move = (index: number, by: -1 | 1) =>
    setValues((v) => {
      const next = [...v.programmeIds];
      const target = index + by;
      if (target < 0 || target >= next.length) return v;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...v, programmeIds: next };
    });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittedRef.current) return; // a double tap sends once; the key would make a second send harmless anyway
    const found = validateFull(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    submittedRef.current = true;
    const context = { page: "/apply", universityId, locale, search: location.search };
    const first = byId.get(values.programmeIds[0] ?? "");
    await flow.start({
      payload: buildFullPayload(values, context),
      universityId,
      onRejected: (fields) => {
        submittedRef.current = false;
        setErrors(fields);
      },
      messageFor: (ref) =>
        fillTemplate(labels.waFull, {
          name: values.name.trim(),
          country: labels.countries[values.country] ?? values.country,
          ref,
          programmes: fillTemplate(labels.waProgrammes, { count: values.programmeIds.length, first: first ? `${first.name}, ${first.universityName}` : "" }),
        }).trim(),
    });
    void refreshQueue();
  }

  const busy = flow.state.phase === "submitting";
  const unsent = queue.filter((item) => item.status !== "sent");

  if (flow.state.phase !== "idle" && flow.state.phase !== "submitting") {
    return (
      <>
        <FlowResult
          state={flow.state}
          labels={labels}
          detailsText={detailsTextOf(labels, {
            ...values,
            extra: [`${labels.programmes}: ${values.programmeIds.map((id) => byId.get(id)?.name ?? id).join("; ")}`],
          })}
        />
        {!online || flow.state.phase === "done" ? <SavedList items={queue} labels={labels} onChange={refreshQueue} /> : null}
      </>
    );
  }

  return (
    <>
      {!online ? (
        <p role="status" className="notice">
          {labels.offlineNote}
        </p>
      ) : null}
      {unsent.length > 0 ? <SavedList items={queue} labels={labels} onChange={refreshQueue} /> : null}

      <form onSubmit={submit} noValidate onFocus={flow.preload} className="lead-form">
        <Field id="apply-name" label={labels.name} error={errorText(labels, errors.name)}>
          <input id="apply-name" type="text" autoComplete="name" value={values.name} onChange={(e) => set("name", e.target.value)} required maxLength={100} aria-invalid={Boolean(errors.name)} aria-describedby={describedBy("apply-name", false, Boolean(errors.name))} />
        </Field>
        <CountrySelect id="apply-country" value={values.country} onChange={(code) => set("country", code)} labels={labels} error={errorText(labels, errors.country_code)} />
        <Field id="apply-whatsapp" label={labels.whatsapp} help={labels.whatsappHelp} error={errorText(labels, errors.whatsapp)}>
          <input id="apply-whatsapp" type="tel" inputMode="tel" autoComplete="tel" value={values.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} required aria-invalid={Boolean(errors.whatsapp)} aria-describedby={describedBy("apply-whatsapp", true, Boolean(errors.whatsapp))} />
        </Field>

        <fieldset className={errors.qualification_type ? "field has-error" : "field"}>
          <legend>{labels.qualification}</legend>
          <label className="check">
            <input type="radio" name="qualification" value="olevel_alevel" checked={values.qualification === "olevel_alevel"} onChange={() => set("qualification", "olevel_alevel")} />
            <span>{labels.qualOlevel}</span>
          </label>
          <label className="check">
            <input type="radio" name="qualification" value="grade10_11" checked={values.qualification === "grade10_11"} onChange={() => set("qualification", "grade10_11")} />
            <span>{labels.qualGrade}</span>
          </label>
          {errors.qualification_type ? (
            <span className="field-error" role="alert">
              {errorText(labels, errors.qualification_type)}
            </span>
          ) : null}
        </fieldset>

        <fieldset className="field">
          <legend>{labels.results}</legend>
          <span className="muted small">{labels.resultsHelp}</span>
          {values.results.map((row, index) => (
            <div key={index} className="result-row">
              <input aria-label={`${labels.subject} ${index + 1}`} type="text" value={row.subject} maxLength={60} onChange={(e) => set("results", values.results.map((r, i) => (i === index ? { ...r, subject: e.target.value } : r)))} />
              <input aria-label={`${labels.grade} ${index + 1}`} type="text" value={row.grade} maxLength={10} onChange={(e) => set("results", values.results.map((r, i) => (i === index ? { ...r, grade: e.target.value } : r)))} />
              <button type="button" className="btn btn-outline btn-small" onClick={() => set("results", values.results.filter((_, i) => i !== index))}>
                {labels.removeRow}
                <span className="sr-only"> {index + 1}</span>
              </button>
            </div>
          ))}
          {values.results.length < MAX_RESULT_ROWS ? (
            <button type="button" className="btn btn-outline btn-small" onClick={() => set("results", [...values.results, { subject: "", grade: "" }])}>
              {labels.addResult}
            </button>
          ) : null}
        </fieldset>

        <fieldset className={errors.programme_ids ? "field has-error" : "field"}>
          <legend>{labels.programmes}</legend>
          <span className="muted small">{labels.programmesHelp}</span>
          {values.programmeIds.length > 0 ? (
            <>
              <p className="muted">{labels.chosen}</p>
              <ol className="chosen">
                {values.programmeIds.map((id, index) => {
                  const programme = byId.get(id);
                  return (
                    <li key={id}>
                      <span>
                        <strong>{labels.rank.replace("{rank}", String(index + 1))}</strong> {programme?.name ?? id}
                        <span className="muted block">{programme?.universityName}</span>
                      </span>
                      <span className="row-actions">
                        <button type="button" className="btn btn-outline btn-small" onClick={() => move(index, -1)} disabled={index === 0}>
                          {labels.moveUp}
                        </button>
                        <button type="button" className="btn btn-outline btn-small" onClick={() => move(index, 1)} disabled={index === values.programmeIds.length - 1}>
                          {labels.moveDown}
                        </button>
                        <button type="button" className="btn btn-outline btn-small" onClick={() => set("programmeIds", values.programmeIds.filter((p) => p !== id))}>
                          {labels.remove}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
          <label className="field">
            <span>{labels.searchProgrammes}</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          </label>
          {matches.length === 0 ? (
            <p className="muted">{labels.noProgrammeMatch}</p>
          ) : (
            <ul className="plain picker">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" className="btn btn-outline btn-small" onClick={() => set("programmeIds", [...values.programmeIds, p.id])}>
                    {labels.add}
                    <span className="sr-only"> {p.name}, {p.universityName}</span>
                  </button>{" "}
                  <span>
                    {p.name} <span className="muted">· {p.universityName}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {errors.programme_ids ? (
            <span className="field-error" role="alert">
              {errorText(labels, errors.programme_ids)}
            </span>
          ) : null}
        </fieldset>

        <Field id="apply-email" label={labels.email} help={labels.emailHelp} error={errorText(labels, errors.email)}>
          <input id="apply-email" type="email" inputMode="email" autoComplete="email" value={values.email} onChange={(e) => set("email", e.target.value)} maxLength={254} aria-invalid={Boolean(errors.email)} aria-describedby={describedBy("apply-email", true, Boolean(errors.email))} />
        </Field>

        <ConsentField id="apply-consent" checked={values.consent} onChange={(checked) => set("consent", checked)} labels={labels} error={errorText(labels, errors.consent)} />

        <TurnstileBox hostRef={flow.hostRef} active={flow.interactive} labels={labels} />

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? (online ? labels.sending : labels.saving) : labels.continue}
        </button>
      </form>
    </>
  );
}

/** Applications still on this phone, with their state and "Remove from this phone", asked twice (architecture 16 A5 step 8). */
function SavedList({ items, labels, onChange }: { items: QueuedLead[]; labels: LeadLabels; onChange: () => Promise<void> }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const now = Date.now();
  const shown = items.filter((item) => item.status !== "sent");
  if (shown.length === 0) return null;
  const text = (state: ReturnType<typeof displayState>) =>
    ({ saved: labels.statusSaved, sending: labels.statusSending, sent: labels.statusSent, not_sent: labels.statusNotSent, rejected: labels.statusRejected })[state];

  return (
    <section className="notice saved-banner" aria-label={labels.savedBanner}>
      <p>
        <strong>{labels.savedBanner}</strong>
      </p>
      <ul className="plain">
        {shown.map((item) => (
          <li key={item.key}>
            <span className="chip-status chip-saved">{text(displayState(item, now))}</span> <span>{item.ref}</span>{" "}
            {confirming === item.key ? (
              <span role="alert">
                {labels.confirmRemove}{" "}
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={async () => {
                    await removeLead(item.key).catch(() => undefined);
                    setConfirming(null);
                    await onChange();
                  }}
                >
                  {labels.removeFromPhone}
                </button>{" "}
                <button type="button" className="btn btn-outline btn-small" onClick={() => setConfirming(null)}>
                  {labels.keep}
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-outline btn-small" onClick={() => setConfirming(item.key)}>
                {labels.removeFromPhone}
                <span className="sr-only"> {item.ref}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
