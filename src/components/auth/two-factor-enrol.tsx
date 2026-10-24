"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api, downloadTextFile } from "@/lib/client/api";
import { codeErrorKey, twoFactorDestination, type TwoFactorStatus } from "@/lib/client/two-factor";
import { CodeForm } from "./code-form";

type Step =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "notOwner" }
  | { kind: "scan"; secret: string; qr: string }
  | { kind: "codes"; recoveryCodes: string[] };

/**
 * C0: first sign-in as owner. A new secret is made on the server, shown as a QR code (drawn here in the browser) and as
 * text; the first correct code confirms it and the ten recovery codes appear once. Nothing is stored in the browser.
 */
export function TwoFactorEnrol() {
  const t = useTranslations("auth.twoFactor");
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const started = useRef(false);

  useEffect(() => {
    // One secret per visit: in development React runs effects twice, and a second call would replace the secret on screen.
    if (started.current) return;
    started.current = true;
    void (async () => {
      const status = await api<TwoFactorStatus>("GET", "/api/v1/auth/two-factor-status");
      if (!status.ok) {
        if (status.status === 401 || status.status === 404) window.location.replace("/sign-in");
        else setStep({ kind: status.status === 403 ? "notOwner" : "unavailable" });
        return;
      }
      const destination = twoFactorDestination(status.data, "enrol");
      if (destination) {
        window.location.replace(destination);
        return;
      }
      const begun = await api<{ otpauthUri: string; secret: string }>("POST", "/api/v1/auth/twoFactor.begin");
      if (!begun.ok) {
        setStep({ kind: begun.status === 409 ? "loading" : "unavailable" });
        if (begun.status === 409) window.location.replace("/two-factor/verify");
        return;
      }
      // Loaded only on this page, so no other page carries the QR code library.
      const { default: qrcode } = await import("qrcode-generator");
      const qr = qrcode(0, "M");
      qr.addData(begun.data.otpauthUri);
      qr.make();
      setStep({ kind: "scan", secret: begun.data.secret, qr: qr.createDataURL(4, 2) });
    })();
  }, []);

  async function confirm(code: string): Promise<string | null> {
    const result = await api<{ recoveryCodes: string[] }>("POST", "/api/v1/auth/twoFactor.confirm", { code });
    if (!result.ok) return t(codeErrorKey(result));
    setStep({ kind: "codes", recoveryCodes: result.data.recoveryCodes });
    return null;
  }

  if (step.kind === "loading") return <p role="status">{t("loading")}</p>;
  if (step.kind === "unavailable") return <p role="alert" className="auth-notice">{t("unavailable")}</p>;
  if (step.kind === "notOwner") return <p role="alert" className="auth-notice">{t("notOwner")}</p>;

  if (step.kind === "codes") {
    return (
      <>
        <h2>{t("codesTitle")}</h2>
        <p>{t("codesBody")}</p>
        <ul className="auth-codes" data-testid="recovery-codes">
          {step.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="auth-actions">
          <button type="button" className="auth-button" onClick={() => downloadTextFile("scollarly-recovery-codes.txt", `${step.recoveryCodes.join("\n")}\n`)}>
            {t("codesDownload")}
          </button>
          <button type="button" className="auth-button" onClick={() => window.location.replace("/admin")}>
            {t("codesSaved")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <p>{t("enrolIntro")}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn in the browser; the image optimiser is not used (CLAUDE.md) */}
      <img className="auth-qr" src={step.qr} alt={t("scanAlt")} width={192} height={192} />
      <p className="auth-muted">
        {t("secretLabel")}: <span className="auth-secret">{step.secret}</span>
      </p>
      <CodeForm label={t("codeLabel")} submitLabel={t("confirm")} busyLabel={t("working")} onSubmit={confirm} />
    </>
  );
}
