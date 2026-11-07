"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { api, type ApiResult } from "@/lib/client/api";
import { LETTER_KINDS, PIPELINE_STAGE_CODES, REQUIRED_DOCUMENT_KINDS } from "@/lib/constants";
import { contentTypeOf, realDeps, uploadDocument, type UploadReason } from "@/lib/client/upload-document";
import { formatWat } from "@/lib/time";
import { nextStep } from "@/modules/pipeline/steps";
import { useAdminSession } from "../admin-shell";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FieldError, Label } from "../ui/input";

export interface FileDocument {
  id: string;
  kind: string;
  state: "pending" | "uploaded" | "approved" | "rejected" | "purged";
  contentType: string;
  byteSize: number;
  rejectionNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface StudentFileData {
  leadId: string;
  version: string;
  stage: string;
  status: string;
  closedReason: string | null;
  studentId: string | null;
  clock: { state: "none" } | { state: "running" | "overdue"; dueAt: string };
  quiet: "active" | "quiet" | "suggest_close";
  documents: FileDocument[];
}

/** The key of the words a failed call should show, from the tokens the server sends (never sentences). */
function failureKeyOf(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (result.status === 0) return "network";
  if (result.status === 401 || result.status === 403) return "forbidden";
  if (result.fields.stage === "DOCUMENTS_MISSING") return "documentsMissing";
  if (result.fields.stage === "REQUIRED") return "noteRequired";
  if (result.fields.stage === "NOT_ALLOWED") return "notAllowed";
  if (result.code === "CONFLICT" && result.fields.version === "STALE") return "stale";
  if (result.code === "CONFLICT" && result.fields.lead === "UNAVAILABLE") return "unavailable";
  if (result.code === "CONFLICT") return "conflict";
  if (result.status === 503) return "unavailable";
  if (result.code === "NOT_FOUND") return "notFound";
  return "generic";
}

const UPLOAD_ERROR: Partial<Record<UploadReason, string>> = {
  TOO_LARGE: "uploadTooLarge",
  WRONG_TYPE: "uploadPdfOnly",
  NETWORK: "network",
  SIGN_IN: "forbidden",
  UNAVAILABLE: "unavailable",
};

/**
 * What the student screen adds for a manager or an admin (S18.1; architecture 24.9): the one Next step button, the student's documents with
 * approve and "ask for a clearer copy", the Admin's letters and proof of payment, and (Admin only, S18.2) back one step, close and reopen. Every
 * change is one POST that carries the version the screen read, then the screen reads again. The server decides what is allowed; the buttons only
 * decide what to show.
 */
export function StudentFile({ data, stageNames, reload }: { data: StudentFileData; stageNames: (code: string) => string; reload: () => void }) {
  const t = useTranslations("admin.lead.file");
  const common = useTranslations("admin.common");
  const session = useAdminSession();
  const isAdmin = session.role === "admin";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [backNote, setBackNote] = useState("");
  const [closeReason, setCloseReason] = useState("no_response");
  const [letterKind, setLetterKind] = useState<(typeof LETTER_KINDS)[number]>("offer_letter");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const open = data.status === "open";
  const next = nextStep(data.stage);
  const approvedRequired = REQUIRED_DOCUMENT_KINDS.filter((kind) => data.documents.some((d) => d.kind === kind && d.state === "approved")).length;
  // A manager is held to the document rule at step 2; the Admin may move on. (The server checks it too, and for the passport as well.)
  const blockedByDocuments = !isAdmin && data.stage === "documents" && approvedRequired < REQUIRED_DOCUMENT_KINDS.length;
  const hasLetters = data.documents.some((d) => (LETTER_KINDS as readonly string[]).includes(d.kind));

  async function post(path: string, body: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await api("POST", `/api/v1/admin/${path}`, body);
    setBusy(false);
    if (result.ok) {
      reload();
      return true;
    }
    if (result.status === 401) window.location.replace("/sign-in");
    setError(failureKeyOf(result));
    return false;
  }

  async function openFile(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await api<{ url: string }>("GET", `/api/v1/admin/document-link?id=${id}`);
    setBusy(false);
    if (result.ok) window.location.assign(result.data.url); // served as an attachment, so the screen stays where it is
    else setError(failureKeyOf(result));
  }

  async function sendLetter(file: File | undefined) {
    if (!file || !data.studentId || uploading) return;
    setError(null);
    // A letter is a PDF: anything else is refused here, before a link is asked for.
    if (contentTypeOf(file) !== "application/pdf") {
      setError("uploadPdfOnly");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setUploading(true);
    const outcome = await uploadDocument(file, { studentId: data.studentId, kind: letterKind }, realDeps, { sign: "/api/v1/admin/documents.sign", confirm: "/api/v1/admin/documents.confirm" });
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (outcome.ok) reload();
    else setError(UPLOAD_ERROR[outcome.reason] ?? "uploadFailed");
  }

  const clockText =
    data.clock.state === "none"
      ? null
      : t(data.clock.state === "overdue" ? "clock.overdue" : "clock.running", { when: formatWat(new Date(data.clock.dueAt)) });

  return (
    <section aria-labelledby="student-file-title" className="mt-8 rounded-lg border border-border p-4" data-testid="student-file">
      <h2 id="student-file-title" className="text-xl font-semibold">
        {t("title")}
      </h2>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant={data.status === "open" ? "default" : data.status === "arrived" ? "success" : "warning"} data-testid="file-status">
          {t(`status.${data.status}`)}
        </Badge>
        {data.status === "closed" && data.closedReason ? <span className="text-fg-muted">{t(`closeReason.${data.closedReason}`)}</span> : null}
        {clockText ? (
          <Badge variant={data.clock.state === "overdue" ? "danger" : "default"} data-testid="file-clock">
            {clockText}
          </Badge>
        ) : null}
        {data.quiet !== "active" ? (
          <Badge variant="warning" data-testid="file-quiet">
            {t(data.quiet === "suggest_close" ? "quiet.suggestClose" : "quiet.quiet")}
          </Badge>
        ) : null}
      </p>

      {error ? (
        <div role="alert" className="mt-3 rounded-md border border-danger p-3 text-danger" data-testid="file-error">
          <p>{t(`errors.${error}`)}</p>
          {error === "stale" || error === "conflict" || error === "unavailable" ? (
            <Button className="mt-2" variant="outline" onClick={() => { setError(null); reload(); }}>
              {t("reload")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="mt-4" data-testid="next-step">
          {next ? (
            <>
              <Button disabled={busy || blockedByDocuments} onClick={() => void post("leads.changeStage", { leadId: data.leadId, stage: next, version: data.version })} data-testid="next-step-button">
                {t("nextStep", { step: stageNames(next) })}
              </Button>
              {blockedByDocuments ? <p className="mt-2 text-sm text-fg-muted">{t("documentsHint", { approved: approvedRequired, total: REQUIRED_DOCUMENT_KINDS.length })}</p> : null}
            </>
          ) : (
            <p className="text-fg-muted">{t("lastStep")}</p>
          )}
        </div>
      ) : null}

      <h3 className="mt-6 text-lg font-semibold">{t("documents.title")}</h3>
      {data.studentId === null ? (
        <p className="text-fg-muted">{t("documents.noAccount")}</p>
      ) : data.documents.length === 0 ? (
        <p className="text-fg-muted" data-testid="docs-empty">
          {t("documents.none")}
        </p>
      ) : (
        <ul className="mt-2 space-y-3" data-testid="docs-list">
          {data.documents.map((doc) => {
            const isLetter = (LETTER_KINDS as readonly string[]).includes(doc.kind);
            const canOpen = doc.state !== "pending";
            return (
              <li key={doc.id} className="rounded-md border border-border p-3" data-testid={`doc-${doc.kind}`}>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t(`kinds.${doc.kind}`)}</span>
                  <Badge variant={doc.state === "approved" ? "success" : doc.state === "rejected" ? "danger" : "default"}>{t(`state.${doc.state}`)}</Badge>
                  <span className="text-sm text-fg-muted">{formatWat(new Date(doc.createdAt))}</span>
                </p>
                {doc.rejectionNote ? <p className="mt-1 text-sm text-fg-muted">{t("documents.reason", { note: doc.rejectionNote })}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {canOpen ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void openFile(doc.id)}>
                      {t("documents.open")}
                    </Button>
                  ) : null}
                  {doc.state === "uploaded" && !isLetter && doc.kind !== "payment_proof" ? (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => void post("documents.review", { id: doc.id, decision: "approved" })}>
                        {t("documents.approve")}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRejecting(doc.id); setRejectNote(""); }}>
                        {t("documents.reject")}
                      </Button>
                    </>
                  ) : null}
                  {doc.state === "uploaded" && doc.kind === "payment_proof" && isAdmin ? (
                    <Button size="sm" disabled={busy} onClick={() => void post("payments.proofApprove", { id: doc.id })}>
                      {t("documents.approveProof")}
                    </Button>
                  ) : null}
                </div>
                {doc.state === "uploaded" && doc.kind === "payment_proof" && !isAdmin ? <p className="mt-1 text-sm text-fg-muted">{t("documents.proofAdmin")}</p> : null}
                {rejecting === doc.id ? (
                  <form
                    className="mt-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const note = rejectNote.trim();
                      if (!note) return;
                      void post("documents.review", { id: doc.id, decision: "rejected", note }).then((ok) => ok && setRejecting(null));
                    }}
                  >
                    <Label htmlFor={`reject-${doc.id}`}>{t("documents.rejectLabel")}</Label>
                    <textarea
                      id={`reject-${doc.id}`}
                      className="min-h-20 w-full rounded-md border border-border bg-bg p-3 text-base"
                      maxLength={300}
                      value={rejectNote}
                      onChange={(event) => setRejectNote(event.target.value)}
                    />
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" type="submit" disabled={busy || rejectNote.trim() === ""}>
                        {t("documents.rejectSend")}
                      </Button>
                      <Button size="sm" type="button" variant="outline" onClick={() => setRejecting(null)}>
                        {common("cancel")}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin && data.studentId !== null && open ? (
        <div className="mt-6" data-testid="letter-upload">
          <h3 className="text-lg font-semibold">{t("letters.title")}</h3>
          <p className="text-sm text-fg-muted">{hasLetters ? t("letters.aboutMore") : t("letters.about")}</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="letter-kind">{t("letters.kind")}</Label>
              <select id="letter-kind" className="min-h-11 rounded-md border border-border bg-bg px-3" value={letterKind} onChange={(event) => setLetterKind(event.target.value as (typeof LETTER_KINDS)[number])} disabled={uploading}>
                {LETTER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="letter-file">{t("letters.file")}</Label>
              <input id="letter-file" ref={fileInput} type="file" accept="application/pdf" disabled={uploading} onChange={(event) => void sendLetter(event.target.files?.[0])} data-testid="letter-input" />
            </div>
          </div>
          {uploading ? (
            <p role="status" className="mt-2">
              {t("letters.uploading")}
            </p>
          ) : null}
          {error && (error === "uploadTooLarge" || error === "uploadPdfOnly" || error === "uploadFailed") ? <FieldError>{t(`errors.${error}`)}</FieldError> : null}
        </div>
      ) : null}

      {isAdmin ? (
        <div className="mt-6 space-y-4" data-testid="admin-file-actions">
          {open && stageIndexOf(data.stage) > 0 ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const note = backNote.trim();
                if (!note) return;
                void post("leads.moveBack", { leadId: data.leadId, version: data.version, note }).then((ok) => ok && setBackNote(""));
              }}
            >
              <Label htmlFor="back-note">{t("back.label", { step: stageNames(PIPELINE_STAGE_CODES[stageIndexOf(data.stage) - 1] as string) })}</Label>
              <textarea id="back-note" className="min-h-16 w-full rounded-md border border-border bg-bg p-3 text-base" maxLength={2000} value={backNote} onChange={(event) => setBackNote(event.target.value)} />
              <Button className="mt-2" type="submit" variant="outline" disabled={busy || backNote.trim() === ""} data-testid="back-button">
                {t("back.button")}
              </Button>
            </form>
          ) : null}

          {open ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="close-reason">{t("close.reason")}</Label>
                <select id="close-reason" className="min-h-11 rounded-md border border-border bg-bg px-3" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} disabled={busy}>
                  {(["no_response", "refused", "withdrew", "other"] as const).map((reason) => (
                    <option key={reason} value={reason}>
                      {t(`closeReason.${reason}`)}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant={data.quiet === "suggest_close" ? "default" : "outline"} disabled={busy} onClick={() => void post("leads.close", { leadId: data.leadId, version: data.version, reason: closeReason })} data-testid="close-button">
                {t("close.button")}
              </Button>
            </div>
          ) : null}

          {data.status === "closed" ? (
            <Button variant="outline" disabled={busy} onClick={() => void post("leads.reopen", { leadId: data.leadId, version: data.version })} data-testid="reopen-button">
              {t("reopen")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function stageIndexOf(code: string): number {
  return (PIPELINE_STAGE_CODES as readonly string[]).indexOf(code);
}
