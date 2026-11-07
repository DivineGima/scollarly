"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every signed-in screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { type UploadReason, uploadDocument } from "@/lib/client/upload-document";
import { MAX_DOCUMENT_BYTES, REQUIRED_DOCUMENT_KINDS, STUDENT_COUNTRIES } from "@/lib/constants";
import { isCourseField } from "@/lib/courses";
import { MeStatus, useMeData } from "./use-me-data";
import "./student.css";

/**
 * "My file" (S17.2, S17.3; PRD_5 FR-43 to FR-46): the step-2 form (prefilled), the documents, the proof of payment and the letters the admin has
 * sent. A shell with no data: everything is read in the browser (ADR-040). Each document is its own upload, so one that fails is tried again alone.
 */

interface FormData {
  fixed: { name: string; whatsapp: string; email: string | null; courseFields: string[]; academicYear: number };
  values: Record<FieldKey, string>;
  completed: boolean;
  application: { id: string; ref: string; stageCode: string; status: string } | null;
  passportRequired: boolean;
  editable: boolean;
}

type DocState = "pending" | "uploaded" | "approved" | "rejected";
interface DocumentRow {
  id: string;
  kind: string;
  state: DocState;
  byteSize: number;
  rejectionNote: string | null;
}

const FIELD_KEYS = ["dateOfBirth", "gender", "nationality", "residenceState", "city", "address", "guardianName", "guardianPhone", "motherName", "motherPhone"] as const;
type FieldKey = (typeof FIELD_KEYS)[number] | "passportNumber";

const GENDERS = ["female", "male", "other"] as const;
const LETTERS = ["offer_letter", "acceptance_letter"] as const;
/** The proof of payment is asked for from step 4 (the offer letter) on. */
const PROOF_FROM = ["offer_letter", "registration", "visa", "arrived"];

export function FilePanel() {
  const t = useTranslations("me.file");
  const form = useMeData<FormData>("/api/v1/me/application-form");
  const docs = useMeData<{ documents: DocumentRow[] }>("/api/v1/me/documents");

  return (
    <section aria-labelledby="file-title">
      <h1 id="file-title">{t("title")}</h1>
      <MeStatus state={form.state} reload={form.reload} />
      {form.state.status === "ready" ? (
        <>
          <FormSection data={form.state.data} />
          <DocumentsSection data={form.state.data} docs={docs} />
        </>
      ) : null}
    </section>
  );
}

// ---- the form -----------------------------------------------------------------------------------------------------------------------

function FormSection({ data }: { data: FormData }) {
  const t = useTranslations("me.file");
  const courses = useTranslations("courses");
  const locale = useLocale();
  const uid = useId();
  const [values, setValues] = useState<Record<FieldKey, string>>(data.values);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const summary = useRef<HTMLParagraphElement>(null);

  const regions = new Intl.DisplayNames([locale], { type: "region" });
  const set = (key: FieldKey, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    if (phase !== "saving") setPhase("idle");
  };

  if (!data.application) {
    return (
      <div className="me-card" data-testid="file-not-applied">
        <h2>{t("form.title")}</h2>
        <p>{t("form.notApplied")}</p>
        <a className="me-button" href="/me/apply">
          {t("form.applyFirst")}
        </a>
      </div>
    );
  }

  const readOnly = !data.editable;
  const needed: FieldKey[] = data.passportRequired ? [...FIELD_KEYS, "passportNumber"] : [...FIELD_KEYS];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (phase === "saving") return;
    // What can be said at once, without asking the server: every field is needed.
    const missing: Partial<Record<string, string>> = {};
    for (const key of needed) if (values[key].trim() === "") missing[key] = "REQUIRED";
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      setPhase("failed");
      setFailure("fields");
      summary.current?.focus();
      return;
    }
    setPhase("saving");
    setFailure(null);
    const body = Object.fromEntries(needed.map((key) => [key, values[key].trim()]));
    const result = await api("POST", "/api/v1/me/applicationForm.save", body);
    if (result.ok) {
      setErrors({});
      // The screen already shows what was saved, so it is not read again (that would blank it and lose this message).
      setPhase("saved");
      return;
    }
    setPhase("failed");
    if (result.status === 0) setFailure("network");
    else if (result.status === 401) setFailure("signIn");
    else if (result.status === 409) setFailure(result.fields.form === "CLOSED" ? "closed" : "notApplied");
    else if (Object.keys(result.fields).length > 0) {
      setErrors(result.fields);
      setFailure("fields");
    } else setFailure("generic");
    summary.current?.focus();
  }

  const fieldError = (key: FieldKey) => (errors[key] ? (t.has(`form.errors.${errors[key]}`) ? t(`form.errors.${errors[key]}`) : t("form.errors.INVALID")) : null);

  // A plain function, not a component: a component defined here would be a new one on every keystroke and the input would lose focus.
  function field(name: FieldKey, options: { type?: string; autoComplete?: string; children?: React.ReactNode } = {}) {
    const { type = "text", autoComplete, children } = options;
    const id = `${uid}-${name}`;
    const error = fieldError(name);
    return (
      <div className="me-field" key={name}>
        <label htmlFor={id}>{t(`form.fields.${name}`)}</label>
        {children ?? (
          <input
            id={id}
            name={name}
            type={type}
            value={values[name]}
            autoComplete={autoComplete}
            readOnly={readOnly}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            max={type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
            onChange={(event) => set(name, event.target.value)}
          />
        )}
        {error ? (
          <p id={`${id}-error`} className="me-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const selectField = (name: "gender" | "nationality", options: { value: string; label: string }[]) => {
    const id = `${uid}-${name}`;
    return field(name, {
      children: (
        <select id={id} name={name} value={values[name]} disabled={readOnly} aria-invalid={errors[name] ? true : undefined} onChange={(event) => set(name, event.target.value)}>
          <option value="">{t("form.choose")}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ),
    });
  };

  return (
    <form className="me-card" noValidate onSubmit={(event) => void save(event)} aria-labelledby={`${uid}-title`} data-testid="file-form">
      <h2 id={`${uid}-title`}>{t("form.title")}</h2>
      <p className="me-muted">{t("form.intro")}</p>

      <dl className="file-fixed">
        <dt>{t("form.fixed.name")}</dt>
        <dd>{data.fixed.name}</dd>
        <dt>{t("form.fixed.whatsapp")}</dt>
        <dd>{data.fixed.whatsapp}</dd>
        {data.fixed.email ? (
          <>
            <dt>{t("form.fixed.email")}</dt>
            <dd>{data.fixed.email}</dd>
          </>
        ) : null}
        <dt>{t("form.fixed.course")}</dt>
        <dd>{data.fixed.courseFields.map((c) => (isCourseField(c) ? courses(c) : c)).join(", ")}</dd>
        <dt>{t("form.fixed.year")}</dt>
        <dd>{data.fixed.academicYear}</dd>
      </dl>
      <p className="me-muted">{t("form.fixedHelp")}</p>

      {readOnly ? <p className="me-notice">{t("form.readOnly")}</p> : null}

      {field("dateOfBirth", { type: "date", autoComplete: "bday" })}
      {selectField(
        "gender",
        GENDERS.map((g) => ({ value: g, label: t(`form.gender.${g}`) })),
      )}
      {selectField(
        "nationality",
        STUDENT_COUNTRIES.map((c) => ({ value: c, label: regions.of(c) ?? c })),
      )}
      {field("residenceState", { autoComplete: "address-level1" })}
      {field("city", { autoComplete: "address-level2" })}
      {field("address", { autoComplete: "street-address" })}
      {field("guardianName")}
      {field("guardianPhone", { type: "tel", autoComplete: "tel" })}
      {field("motherName")}
      {field("motherPhone", { type: "tel" })}
      {data.passportRequired ? (
        <>
          <p className="me-muted">{t("form.passportHelp")}</p>
          {field("passportNumber")}
        </>
      ) : null}

      <p ref={summary} tabIndex={-1} role={phase === "failed" ? "alert" : "status"} className={phase === "failed" ? "me-notice me-notice-error" : "me-muted"} data-testid="file-form-status">
        {phase === "saving" ? t("form.saving") : null}
        {phase === "saved" ? t("form.saved") : null}
        {phase === "failed" ? t(`form.failure.${failure ?? "generic"}`) : null}
      </p>
      {readOnly ? null : (
        <div className="me-actions">
          <button type="submit" className="me-button" disabled={phase === "saving"} data-testid="file-form-save">
            {phase === "saving" ? t("form.saving") : data.completed || phase === "saved" ? t("form.update") : t("form.save")}
          </button>
        </div>
      )}
    </form>
  );
}

// ---- the documents --------------------------------------------------------------------------------------------------------------------

/** What to show for one kind: the live copy, or else the latest. */
function latestOf(rows: DocumentRow[], kind: string): DocumentRow | null {
  const mine = rows.filter((d) => d.kind === kind);
  return mine.findLast((d) => d.state !== "rejected") ?? mine.at(-1) ?? null;
}

function DocumentsSection({ data, docs }: { data: FormData; docs: ReturnType<typeof useMeData<{ documents: DocumentRow[] }>> }) {
  const t = useTranslations("me.file");
  if (!data.application) return null;
  const kinds = data.passportRequired ? [...REQUIRED_DOCUMENT_KINDS, "passport"] : [...REQUIRED_DOCUMENT_KINDS];
  const rows = docs.state.status === "ready" ? docs.state.data.documents : [];
  const showProof = PROOF_FROM.includes(data.application.stageCode);

  return (
    <>
      <div className="me-card" data-testid="file-documents">
        <h2>{t("documents.title")}</h2>
        <p className="me-muted">{t("documents.intro", { mb: MAX_DOCUMENT_BYTES / (1024 * 1024) })}</p>
        <MeStatus state={docs.state} reload={docs.reload} />
        {docs.state.status === "ready" ? (
          <ul className="file-docs">
            {kinds.map((kind) => (
              <DocumentRowView key={kind} kind={kind} current={latestOf(rows, kind)} editable={data.editable} onDone={docs.reload} />
            ))}
          </ul>
        ) : null}
      </div>

      {docs.state.status === "ready" && showProof ? (
        <div className="me-card" data-testid="file-proof">
          <h2>{t("proof.title")}</h2>
          <p>{t("proof.intro")}</p>
          <ul className="file-docs">
            <DocumentRowView kind="payment_proof" current={latestOf(rows, "payment_proof")} editable={data.editable} onDone={docs.reload} />
          </ul>
        </div>
      ) : null}

      {docs.state.status === "ready" ? <LettersSection rows={rows} /> : null}
    </>
  );
}

function reasonKey(reason: UploadReason): string {
  return reason;
}

function DocumentRowView({ kind, current, editable, onDone }: { kind: string; current: DocumentRow | null; editable: boolean; onDone: () => void }) {
  const t = useTranslations("me.file");
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<UploadReason | null>(null);
  // The chosen file stays here while it is sent, so a failure is tried again with one tap and no new choice; it is dropped once it has gone.
  const [chosen, setChosen] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setChosen(file);
    const outcome = await uploadDocument(file, { kind });
    setBusy(false);
    if (outcome.ok) {
      setChosen(null);
      if (input.current) input.current.value = "";
      onDone();
    } else setProblem(outcome.reason);
  }

  const state = current?.state ?? "none";
  const approved = state === "approved";
  return (
    <li className="file-doc" data-testid={`doc-${kind}`} data-state={state}>
      <div>
        <strong>{t(`documents.kinds.${kind}`)}</strong>
        <span className="file-doc-state" data-testid={`doc-${kind}-state`}>
          {t(`documents.states.${state}`)}
        </span>
        {state === "rejected" && current?.rejectionNote ? <p className="me-muted">{t("documents.rejectedNote", { note: current.rejectionNote })}</p> : null}
      </div>
      {editable && !approved ? (
        <div className="file-doc-actions">
          <label htmlFor={`${id}-file`} className={`me-button me-button-quiet${busy ? " is-busy" : ""}`}>
            {busy ? t("documents.sending") : state === "none" || state === "pending" ? t("documents.choose") : t("documents.replace")}
          </label>
          <input
            ref={input}
            id={`${id}-file`}
            className="file-input"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            disabled={busy}
            data-testid={`doc-${kind}-input`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void send(file);
            }}
          />
          {problem ? (
            <p role="alert" className="me-error" data-testid={`doc-${kind}-error`}>
              {t(`documents.errors.${reasonKey(problem)}`)}
              {chosen && problem !== "TOO_LARGE" && problem !== "WRONG_TYPE" && problem !== "EMPTY" && problem !== "ALREADY_APPROVED" ? (
                <>
                  {" "}
                  <button type="button" className="me-button me-button-quiet" disabled={busy} onClick={() => void send(chosen)} data-testid={`doc-${kind}-retry`}>
                    {t("documents.retry")}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ---- the letters ----------------------------------------------------------------------------------------------------------------------

function LettersSection({ rows }: { rows: DocumentRow[] }) {
  const t = useTranslations("me.file");
  const letters = rows.filter((d) => (LETTERS as readonly string[]).includes(d.kind) && d.state === "uploaded");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; reason: "network" | "generic" } | null>(null);
  if (letters.length === 0) return null;

  async function open(id: string) {
    if (busyId) return;
    setBusyId(id);
    setProblem(null);
    const result = await api<{ url: string }>("GET", `/api/v1/me/document-link?id=${encodeURIComponent(id)}`);
    setBusyId(null);
    // The link serves the file as an attachment, so the page stays where it is.
    if (result.ok) window.location.assign(result.data.url);
    else setProblem({ id, reason: result.status === 0 ? "network" : "generic" });
  }

  return (
    <div className="me-card" data-testid="file-letters">
      <h2>{t("letters.title")}</h2>
      <ul className="file-docs">
        {letters.map((letter) => (
          <li key={letter.id} className="file-doc" data-testid={`letter-${letter.id}`}>
            <strong>{t(`documents.kinds.${letter.kind}`)}</strong>
            <div className="file-doc-actions">
              <button type="button" className="me-button" disabled={busyId !== null} onClick={() => void open(letter.id)} data-testid={`letter-${letter.id}-open`}>
                {busyId === letter.id ? t("letters.opening") : t("letters.download")}
              </button>
              {problem?.id === letter.id ? (
                <p role="alert" className="me-error">
                  {problem.reason === "network" ? t("letters.offline") : t("letters.error")}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
