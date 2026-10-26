"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every signed-in screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { watDateString } from "@/lib/time";
import { clearProgressSnapshot } from "@/offline/progress-snapshot";

type Step = "idle" | "confirm" | "working" | "reauth" | "done";

/** A13 steps 2 and 3: download my data, and delete my data. */
export function DataPanel() {
  const t = useTranslations("me.data");
  return (
    <section>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <ExportCard />
      <EraseCard />
    </section>
  );
}

function ExportCard() {
  const t = useTranslations("me.data.export");
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (state === "working") return;
    setState("working");
    setError(null);
    const result = await api<Record<string, unknown>>("POST", "/api/v1/me/student.exportData", {});
    if (!result.ok) {
      setState("idle");
      setError(result.status === 0 ? "NETWORK" : "GENERIC");
      return;
    }
    // Built in the browser from the answer. Nothing is stored on the server or in a cache.
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scollarly-my-data-${watDateString(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setState("done");
  }

  return (
    <div className="me-card">
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>
      {error ? (
        <p role="alert" className="me-error">
          {t(`errors.${error}` as "errors.GENERIC")}
        </p>
      ) : null}
      {state === "done" ? (
        <p role="status" className="me-notice" data-testid="exported">
          {t("done")}
        </p>
      ) : null}
      <button type="button" className="me-button" disabled={state === "working"} onClick={() => void download()}>
        {state === "working" ? t("working") : t("button")}
      </button>
    </div>
  );
}

function EraseCard() {
  const t = useTranslations("me.data.erase");
  const id = useId();
  const [step, setStep] = useState<Step>("idle");
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  function open() {
    setWord("");
    setError(null);
    setStep("confirm");
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
    setStep("idle");
  }

  async function erase() {
    if (step === "working" || word !== "DELETE") return;
    setStep("working");
    setError(null);
    const result = await api<{ erased: boolean }>("POST", "/api/v1/me/student.requestErasure", { confirm: "DELETE" });
    if (result.ok) {
      // The account and its sessions are gone on the server. Forget what this phone kept, then leave.
      await clearProgressSnapshot();
      setStep("done");
      dialog.current?.close();
      return;
    }
    if (result.fields.session === "REAUTH_REQUIRED") {
      setStep("reauth");
      return;
    }
    setStep("confirm");
    setError(result.status === 0 ? "NETWORK" : result.fields.account === "STAFF" ? "STAFF" : "GENERIC");
  }

  if (step === "done") {
    return (
      <div className="me-card" role="status" data-testid="erased">
        <h2>{t("doneTitle")}</h2>
        <p>{t("done")}</p>
        <a className="me-button" href="/">
          {t("home")}
        </a>
      </div>
    );
  }

  return (
    <div className="me-card">
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>
      <ul>
        <li>{t("kept.payments")}</li>
        <li>{t("kept.counts")}</li>
      </ul>
      <button type="button" className="me-button me-button-danger" onClick={open}>
        {t("button")}
      </button>

      <dialog ref={dialog} aria-labelledby={`${id}-title`} className="me-dialog" onClose={() => setStep((s) => (s === "done" ? s : "idle"))}>
        <h2 id={`${id}-title`}>{t("dialogTitle")}</h2>
        {step === "reauth" ? (
          <>
            <p role="alert" className="me-error" data-testid="reauth">
              {t("reauth")}
            </p>
            <div className="me-actions">
              {/* A full navigation to the Worker's sign-in route, not a page. A fresh sign-in is what proves it is you. */}
              <a className="me-button" href="/auth/start">
                {t("signInAgain")}
              </a>
              <button type="button" className="me-button me-button-quiet" onClick={close}>
                {t("cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{t("warning")}</p>
            <div className="me-field">
              <label htmlFor={`${id}-word`}>{t("typeDelete")}</label>
              <input id={`${id}-word`} value={word} autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={(event) => setWord(event.target.value)} />
            </div>
            {error ? (
              <p role="alert" className="me-error">
                {t(`errors.${error}` as "errors.GENERIC")}
              </p>
            ) : null}
            <div className="me-actions">
              <button type="button" className="me-button me-button-danger" disabled={word !== "DELETE" || step === "working"} onClick={() => void erase()}>
                {step === "working" ? t("working") : t("confirm")}
              </button>
              <button type="button" className="me-button me-button-quiet" onClick={close}>
                {t("cancel")}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
