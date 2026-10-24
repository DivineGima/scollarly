"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { fillTemplate } from "@/lib/lead-form";
import type { FlowState } from "./use-lead-flow";
import { errorText, type LeadLabels } from "./labels";

/** Small pieces both lead forms use. Plain elements and the page's own CSS, no UI library (architecture 5, rule 3). */

export function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string | undefined;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={error ? "field has-error" : "field"}>
      <label htmlFor={id}>{label}</label>
      {help ? (
        <span id={`${id}-help`} className="muted small">
          {help}
        </span>
      ) : null}
      {children}
      {error ? (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, hasHelp: boolean, hasError: boolean): string | undefined {
  const ids = [hasHelp ? `${id}-help` : "", hasError ? `${id}-error` : ""].filter(Boolean).join(" ");
  return ids || undefined;
}

export function CountrySelect({
  id,
  value,
  onChange,
  labels,
  error,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  labels: LeadLabels;
  error: string | undefined;
}) {
  return (
    <Field id={id} label={labels.country} error={error}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required aria-invalid={Boolean(error)} aria-describedby={describedBy(id, false, Boolean(error))}>
        <option value="">{labels.chooseCountry}</option>
        {Object.entries(labels.countries).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ConsentField({ id, checked, onChange, labels, error }: { id: string; checked: boolean; onChange: (checked: boolean) => void; labels: LeadLabels; error: string | undefined }) {
  // The sentence has the link inside it: "... {link} ..." is split so the translation controls the word order.
  const [before = "", after = ""] = labels.consent.split("{link}");
  return (
    <div className={error ? "field has-error" : "field"}>
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={Boolean(error)} aria-describedby={describedBy(id, false, Boolean(error))} />
        <span>
          {before}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            {labels.privacyLink}
          </a>
          {after}
        </span>
      </label>
      {error ? (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Where Turnstile may show its challenge. Empty and invisible unless Cloudflare needs the person to act (architecture 11.3). */
export function TurnstileBox({ hostRef, active, labels }: { hostRef: RefObject<HTMLDivElement | null>; active: boolean; labels: LeadLabels }) {
  return (
    <div className="turnstile-box" data-active={active ? "true" : "false"}>
      {active ? <p role="status">{labels.turnstilePrompt}</p> : null}
      <div ref={hostRef} />
    </div>
  );
}

/** A plain-text copy of what the student typed, for the "Couldn't save" case (architecture 16 A5 step 4). */
export function CopyDetails({ text, labels }: { text: string; labels: LeadLabels }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {labels.copyDetails}
      </button>
      <span role="status" aria-live="polite" className="muted">
        {copied ? labels.copied : ""}
      </span>
    </>
  );
}

/** What the student sees after Continue: sent or saved, the reference, and a button to open WhatsApp (A5 steps 5 to 7). */
export function FlowResult({
  state,
  labels,
  detailsText,
  onClose,
  after,
}: {
  state: Exclude<FlowState, { phase: "idle" } | { phase: "submitting" }>;
  labels: LeadLabels;
  detailsText: string;
  onClose?: () => void;
  after?: ReactNode;
}) {
  if (state.phase === "save_failed") {
    return (
      <div role="alert" className="result">
        <h3>{labels.couldntSave}</h3>
        <p>{labels.couldntSaveHelp}</p>
        <p className="cta-row">
          <CopyDetails text={detailsText} labels={labels} />
        </p>
      </div>
    );
  }

  if (state.phase === "limited") {
    return (
      <div role="alert" className="result">
        <p>{state.reason === "number_limit" ? labels.limitedNumber : labels.limitedRate}</p>
        {state.waUrl ? (
          <p className="cta-row">
            <a className="btn btn-whatsapp" href={state.waUrl} target="_blank" rel="noopener noreferrer">
              {labels.openWhatsApp}
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  const sent = state.result.kind === "sent";
  return (
    <div role="status" className="result">
      <p className={sent ? "chip-status chip-sent" : "chip-status chip-saved"}>{sent ? labels.statusSent : labels.statusSaved}</p>
      <h3>{sent ? labels.doneSentTitle : labels.doneSavedTitle}</h3>
      <p>{sent ? labels.doneSentBody : labels.doneSavedBody}</p>
      <p>
        {labels.reference}: <strong data-testid="lead-ref">{state.result.ref}</strong>
      </p>
      {state.waUrl ? (
        <>
          {/* Always shown: if the browser blocked the jump this is the way in, and it is harmless if WhatsApp already opened. */}
          <p className="cta-row">
            <a className="btn btn-whatsapp" href={state.waUrl} target="_blank" rel="noopener noreferrer">
              {labels.openWhatsApp}
            </a>
          </p>
          {!state.opened ? <p className="muted">{labels.whatsappBlocked}</p> : null}
        </>
      ) : (
        <p>{labels.noWhatsApp}</p>
      )}
      {after}
      {onClose ? (
        <p>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {labels.close}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** The text the student can copy if saving failed: what they typed, in plain lines. */
export function detailsTextOf(labels: LeadLabels, values: { name: string; country: string; whatsapp: string; extra?: string[] }): string {
  return [`${labels.name}: ${values.name}`, `${labels.country}: ${labels.countries[values.country] ?? values.country}`, `${labels.whatsapp}: ${values.whatsapp}`, ...(values.extra ?? [])].join("\n");
}

export { errorText, fillTemplate };
