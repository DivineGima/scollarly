"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";
import { MeStatus, useMeData } from "./use-me-data";

interface ProfileData {
  name: string;
  email: string;
}

/**
 * A13 step 1: the display name can be changed here. The email is the Google account's: it is shown, and it cannot be edited, because
 * sign-in is Google only (ADR-032) and changing it would break the match with the application (architecture 9.6).
 */
export function ProfilePanel() {
  const t = useTranslations("me.profile");
  const { state, reload } = useMeData<ProfileData>("/api/v1/me/profile");
  return (
    <section>
      <h1>{t("title")}</h1>
      <MeStatus state={state} reload={reload} />
      {state.status === "ready" ? <Form data={state.data} /> : null}
    </section>
  );
}

function Form({ data }: { data: ProfileData }) {
  const t = useTranslations("me.profile");
  const id = useId();
  const [name, setName] = useState(data.name);
  const [saved, setSaved] = useState(data.name);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  useEffect(() => {
    if (state !== "done") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "saving") return;
    const value = name.trim();
    if (!value) {
      setError("REQUIRED");
      return;
    }
    setState("saving");
    setError(null);
    const result = await api<{ saved: boolean }>("POST", "/api/v1/me/profile.setName", { name: value });
    if (result.ok) {
      setSaved(value);
      setName(value);
      setState("done");
      return;
    }
    setState("idle");
    setError(result.status === 0 ? "NETWORK" : result.code === "VALIDATION" ? "INVALID" : "GENERIC");
  }

  return (
    <form onSubmit={submit} noValidate className="me-card">
      <div className="me-field">
        <label htmlFor={`${id}-name`}>{t("name")}</label>
        <input id={`${id}-name`} value={name} maxLength={80} autoComplete="name" aria-invalid={error === "REQUIRED" || error === "INVALID" ? true : undefined} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="me-field">
        <label htmlFor={`${id}-email`}>{t("email")}</label>
        <input id={`${id}-email`} value={data.email} readOnly />
        <p className="me-muted">{t("emailHelp")}</p>
      </div>
      {error ? (
        <p role="alert" className="me-error">
          {t(`errors.${error}` as "errors.INVALID")}
        </p>
      ) : null}
      {state === "done" ? (
        <p role="status" className="me-notice">
          {t("saved")}
        </p>
      ) : null}
      <button type="submit" className="me-button" disabled={state === "saving" || name.trim() === saved}>
        {state === "saving" ? t("saving") : t("save")}
      </button>
    </form>
  );
}
