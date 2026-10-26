"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every signed-in screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { api } from "@/lib/client/api";
import { NUMBER_COUNTRIES } from "@/lib/constants";


/** A12: ask an admin to link an application by its reference or by the WhatsApp number it was made with. Nothing is linked here. */
export function LinkForm() {
  const t = useTranslations("me.link");
  const id = useId();
  const [reference, setReference] = useState("");
  const [country, setCountry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    if (!reference.trim()) {
      setError("REQUIRED");
      return;
    }
    setState("sending");
    setError(null);
    const result = await api<{ status: string }>("POST", "/api/v1/me/student.requestLink", { reference: reference.trim(), ...(country ? { country } : {}) });
    if (result.ok) {
      setState("sent");
      return;
    }
    setState("idle");
    if (result.status === 0) setError("NETWORK");
    else if (result.code === "RATE_LIMITED") setError("RATE_LIMITED");
    else if (result.code === "VALIDATION") setError(result.fields.reference ?? "INVALID");
    else setError("GENERIC");
  }

  if (state === "sent") {
    return (
      <section>
        <h1>{t("title")}</h1>
        <p role="status" className="me-notice" data-testid="sent">
          {t("sent")}
        </p>
        <p>
          <a className="me-button" href="/me">
            {t("back")}
          </a>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <form onSubmit={submit} noValidate className="me-card">
        <div className="me-field">
          <label htmlFor={`${id}-ref`}>{t("reference")}</label>
          <input
            id={`${id}-ref`}
            value={reference}
            maxLength={40}
            autoCapitalize="characters"
            autoComplete="off"
            aria-invalid={error && error !== "NETWORK" && error !== "RATE_LIMITED" && error !== "GENERIC" ? true : undefined}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            onChange={(event) => setReference(event.target.value)}
          />
          <p id={`${id}-help`} className="me-muted">
            {t("help")}
          </p>
        </div>
        <div className="me-field">
          <label htmlFor={`${id}-country`}>{t("country")}</label>
          <select id={`${id}-country`} value={country} onChange={(event) => setCountry(event.target.value)}>
            <option value="">{t("noCountry")}</option>
            {NUMBER_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {t(`countries.${c}`)}
              </option>
            ))}
          </select>
          <p className="me-muted">{t("countryHelp")}</p>
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="me-error">
            {t(`errors.${error}` as "errors.INVALID")}
          </p>
        ) : null}
        <button type="submit" className="me-button" disabled={state === "sending"}>
          {state === "sending" ? t("sending") : t("send")}
        </button>
      </form>
    </section>
  );
}
