"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * A10: ends the session on the server (Neon Auth, through our `/api/auth` proxy), then goes to the home page. It runs once the
 * page has loaded; if it fails the person sees why and a button to try again. The offline snapshot of the student's progress
 * (Stage 8, S8.1) is deleted from this same place when that module exists.
 */
export function SignOutRunner() {
  const t = useTranslations("auth.signOut");
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  async function signOut() {
    setFailed(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      // Neon Auth answers 200 when it ended the session and 401 when there was none: either way the person is signed out.
      if (response.ok || response.status === 401) {
        window.location.replace("/");
        return;
      }
    } catch {
      // Offline or unreachable: fall through to the message.
    }
    setFailed(true);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void signOut();
  }, []);

  return failed ? (
    <>
      <p role="alert" className="auth-notice">
        {t("failed")}
      </p>
      <button type="button" className="auth-button" onClick={() => void signOut()}>
        {t("retry")}
      </button>
    </>
  ) : (
    <p role="status">{t("working")}</p>
  );
}
