"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type State = { kind: "checking" } | { kind: "open"; email: string } | { kind: "unusable" } | { kind: "unavailable" };

/**
 * B0: the invite link's page. The token is in the address, never in the page (so the cached HTML holds no secret). The
 * server says only whether the link is open and for which email; "Continue with Google" carries the token through the
 * sign-in, and `/auth/landing` accepts the invite only if Google's verified email matches.
 */
export function InviteAccept() {
  const t = useTranslations("auth.invite");
  const [state, setState] = useState<State>({ kind: "checking" });
  const [token, setToken] = useState("");
  const [rejected, setRejected] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const fromPath = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
    setRejected(new URLSearchParams(window.location.search).has("error"));
    if (!TOKEN.test(fromPath)) {
      setState({ kind: "unusable" });
      return;
    }
    setToken(fromPath);
    setState({ kind: "checking" });
    let live = true;
    void api<{ status: "open" | "unusable"; email?: string }>("POST", "/api/v1/invites/check", { token: fromPath }).then((result) => {
      if (!live) return;
      if (!result.ok) setState({ kind: "unavailable" });
      else setState(result.data.status === "open" && result.data.email ? { kind: "open", email: result.data.email } : { kind: "unusable" });
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  if (state.kind === "checking") return <p role="status">{t("checking")}</p>;
  if (state.kind === "unavailable") {
    return (
      <>
        <p role="alert" className="auth-notice">
          {t("unavailable")}
        </p>
        <button type="button" className="auth-button" onClick={() => setAttempt((n) => n + 1)}>
          {t("retry")}
        </button>
      </>
    );
  }
  if (state.kind === "unusable") {
    return (
      <p role="alert" className="auth-notice">
        {t("unusable")}
      </p>
    );
  }
  return (
    <>
      <p>{t("forEmail", { email: state.email })}</p>
      {rejected ? (
        <p role="alert" className="auth-notice">
          {t("wrongAccount", { email: state.email })}
        </p>
      ) : null}
      <a className="auth-button" href={`/auth/start?invite=${token}`}>
        {t("continue")}
      </a>
    </>
  );
}
