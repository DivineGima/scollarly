"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { codeErrorKey, twoFactorDestination, type TwoFactorStatus } from "@/lib/client/two-factor";
import { CodeForm } from "./code-form";

type Load = "loading" | "ready" | "unavailable" | "notOwner";

/** C1: the code prompt on later sign-ins, or a single-use recovery code. A success marks this session 2FA verified. */
export function TwoFactorVerify() {
  const t = useTranslations("auth.twoFactor");
  const [load, setLoad] = useState<Load>("loading");
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    let live = true;
    void api<TwoFactorStatus>("GET", "/api/v1/auth/two-factor-status").then((result) => {
      if (!live) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 404) window.location.replace("/sign-in");
        else if (result.status === 403) setLoad("notOwner");
        else setLoad("unavailable");
        return;
      }
      const destination = twoFactorDestination(result.data, "verify");
      if (destination) window.location.replace(destination);
      else setLoad("ready");
    });
    return () => {
      live = false;
    };
  }, []);

  async function verify(code: string): Promise<string | null> {
    const result = await api("POST", recovery ? "/api/v1/auth/twoFactor.recovery" : "/api/v1/auth/twoFactor.verify", { code });
    if (result.ok) {
      window.location.replace("/admin");
      return null;
    }
    return t(codeErrorKey(result));
  }

  if (load === "loading") return <p role="status">{t("loading")}</p>;
  if (load === "unavailable") return <p role="alert" className="auth-notice">{t("unavailable")}</p>;
  if (load === "notOwner") return <p role="alert" className="auth-notice">{t("notOwner")}</p>;

  return (
    <>
      <p>{t("verifyIntro")}</p>
      <CodeForm
        key={recovery ? "recovery" : "app"}
        label={recovery ? t("recoveryLabel") : t("codeLabel")}
        submitLabel={t("verify")}
        busyLabel={t("working")}
        recovery={recovery}
        onSubmit={verify}
      />
      <p>
        <button type="button" className="auth-button auth-button-quiet" onClick={() => setRecovery((value) => !value)}>
          {recovery ? t("useApp") : t("useRecovery")}
        </button>
      </p>
    </>
  );
}
