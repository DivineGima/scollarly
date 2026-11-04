"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { isCourseField } from "@/lib/courses";
import { PROFILE_RELATIONSHIPS, type ProfileRelationship } from "@/lib/constants";
import { api } from "@/lib/client/api";
import { PASSWORD_MIN, PASSWORD_SIGN_IN_PATH, PASSWORD_SIGN_UP_PATH, validateSignIn, validateSignUp, type PasswordIssues } from "@/modules/auth/password";
import { safeNext } from "@/modules/gate/next";

/**
 * Email and password sign-up and sign-in (PRD_3 F21, ADR-052). One form for both pages. It checks the details with the same rules as
 * the server, sends them to the Worker, and on success goes to `/auth/landing`, which chooses the page for the person exactly as it does
 * after Google (a new account goes to onboarding, an old one to its home or back to `next`). Errors are plain sentences next to the field,
 * and a wrong password never says whether the email exists. The password is never stored by the page.
 */

type Mode = "sign-in" | "sign-up";

export function EmailPasswordForm({ mode }: { mode: Mode }) {
  const t = useTranslations("auth.email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [as, setAs] = useState<ProfileRelationship>("student");
  const [shown, setShown] = useState(false);
  const [issues, setIssues] = useState<PasswordIssues>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  const [course, setCourse] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeNext(params.get("next")));
    const value = params.get("course");
    setCourse(isCourseField(value) ? value : null);
    const wanted = params.get("as");
    if ((PROFILE_RELATIONSHIPS as readonly string[]).includes(wanted ?? "")) setAs(wanted as ProfileRelationship);
  }, []);

  function landingUrl(): string {
    const params = new URLSearchParams();
    if (mode === "sign-up") {
      params.set("intent", "sign-up");
      params.set("as", as);
      if (course) params.set("course", course);
    }
    if (next) params.set("next", next);
    const query = params.toString();
    return query ? `/auth/landing?${query}` : "/auth/landing";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const found = mode === "sign-up" ? validateSignUp({ name, email, password }) : validateSignIn({ email, password });
    setIssues(found);
    if (Object.keys(found).length > 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setFormError(t("offline"));
      return;
    }
    setBusy(true);
    const result = await api<{ status: string }>("POST", mode === "sign-up" ? PASSWORD_SIGN_UP_PATH : PASSWORD_SIGN_IN_PATH, mode === "sign-up" ? { name, email, password } : { email, password });
    if (result.ok) {
      // Keep the busy state: the page is leaving. The password field is cleared first so nothing lingers if the back button is used.
      setPassword("");
      window.location.assign(landingUrl());
      return;
    }
    setBusy(false);
    if (result.status === 0) setFormError(t("offline"));
    else if (result.status === 429) setFormError(t("tooMany"));
    else if (result.status >= 500) setFormError(t("unavailable"));
    else if (result.fields.form === "bad_credentials" || result.status === 401) setFormError(t("badCredentials"));
    else if (result.fields.form === "cannot_sign_up") setFormError(t("cannotSignUp"));
    else {
      setIssues(
        Object.fromEntries(Object.entries(result.fields).filter(([key]) => key === "name" || key === "email" || key === "password")) as PasswordIssues,
      );
      setFormError(t("check"));
    }
  }

  const error = (field: "name" | "email" | "password") => {
    const issue = issues[field];
    return issue ? t(`issue.${field}.${issue}`, { min: PASSWORD_MIN }) : null;
  };

  const field = (id: string, label: string, input: React.ReactNode, message: string | null) => (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      {input}
      {message ? (
        <p id={`${id}-error`} className="auth-error" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );

  return (
    <form className="auth-email" onSubmit={submit} noValidate aria-label={mode === "sign-up" ? t("signUpTitle") : t("signInTitle")} data-testid={`email-form-${mode}`}>
      <p className="auth-divider">{t("or")}</p>
      {mode === "sign-up" ? (
        <fieldset className="auth-choices-set">
          <legend>{t("role")}</legend>
          {(["student", "parent"] as const).map((value) => (
            <label key={value} className="auth-radio">
              <input type="radio" name="as" value={value} checked={as === value} onChange={() => setAs(value)} />
              {t(`as.${value}`)}
            </label>
          ))}
        </fieldset>
      ) : null}
      {mode === "sign-up"
        ? field(
            "email-name",
            t("name"),
            <input id="email-name" type="text" autoComplete="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(issues.name)} aria-describedby={issues.name ? "email-name-error" : undefined} />,
            error("name"),
          )
        : null}
      {field(
        "email-address",
        t("email"),
        <input id="email-address" type="email" inputMode="email" autoComplete={mode === "sign-up" ? "email" : "username"} value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(issues.email)} aria-describedby={issues.email ? "email-address-error" : undefined} />,
        error("email"),
      )}
      {field(
        "email-password",
        t("password"),
        <span className="auth-password">
          <input id="email-password" type={shown ? "text" : "password"} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} value={password} maxLength={128} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(issues.password)} aria-describedby={issues.password ? "email-password-error" : undefined} />
          <button type="button" className="auth-show" onClick={() => setShown(!shown)} aria-pressed={shown}>
            {shown ? t("hide") : t("show")}
          </button>
        </span>,
        error("password"),
      )}
      {mode === "sign-up" ? <p className="auth-muted">{t("passwordHelp", { min: PASSWORD_MIN })}</p> : <p className="auth-muted">{t("forgot")}</p>}
      {formError ? (
        <p className="auth-error" role="alert" data-testid="email-form-error">
          {formError}
        </p>
      ) : null}
      <button type="submit" className="auth-button auth-submit" disabled={busy}>
        {busy ? t("working") : mode === "sign-up" ? t("signUp") : t("signIn")}
      </button>
    </form>
  );
}
