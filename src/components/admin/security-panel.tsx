"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api, downloadTextFile } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { useAdminSession } from "./admin-shell";
import { useStepUp } from "./step-up";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { DataStatus, useAdminData } from "./use-admin-data";

interface SecurityData {
  twoFactorEnabled: boolean;
  sessions: { createdAt: string; expiresAt: string; isCurrent: boolean }[];
}

/** C6: 2FA status, active sessions, new recovery codes (step-up), sign out everywhere else. */
export function SecurityPanel() {
  const t = useTranslations("admin.security");
  const common = useTranslations("admin.common");
  const session = useAdminSession();
  const stepUp = useStepUp();
  const { state, reload } = useAdminData<SecurityData>(session.role === "owner" ? "/api/v1/admin/security" : null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const result = await stepUp(() => api<{ recoveryCodes: string[] }>("POST", "/api/v1/admin/security.regenerateRecoveryCodes"));
    setBusy(false);
    if (result.ok) setCodes(result.data.recoveryCodes);
    else setFailed(true);
  }

  async function signOutEverywhere() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setFailed(false);
    const result = await api<{ ended: number }>("POST", "/api/v1/admin/security.signOutEverywhere");
    setBusy(false);
    if (result.ok) {
      setMessage(t("signedOutEverywhere", { count: result.data.ended }));
      reload();
    } else setFailed(true);
  }

  if (session.role !== "owner") return null;

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <DataStatus state={state} reload={reload} />
      {state.status === "ready" ? (
        <>
          <h2 className="mt-8 text-xl font-semibold">{t("twoFactor")}</h2>
          <p className="mt-2">{state.data.twoFactorEnabled ? t("twoFactorOn") : t("twoFactorOff")}</p>
          <p className="mt-2 text-fg-muted">{t("regenerateBody")}</p>
          <Button className="mt-3" variant="outline" disabled={busy || !state.data.twoFactorEnabled} onClick={() => void regenerate()}>
            {t("regenerate")}
          </Button>

          <h2 className="mt-8 text-xl font-semibold">{t("sessions")}</h2>
          <ul className="mt-3 space-y-2">
            {state.data.sessions.map((entry) => (
              <li key={entry.createdAt} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                <span>{t("started", { date: formatWat(new Date(entry.createdAt)) })}</span>
                {entry.isCurrent ? <Badge variant="success">{t("thisSession")}</Badge> : null}
              </li>
            ))}
          </ul>
          <Button className="mt-4" variant="outline" disabled={busy} onClick={() => void signOutEverywhere()}>
            {t("signOutEverywhere")}
          </Button>
        </>
      ) : null}
      {message ? <p role="status" className="mt-3">{message}</p> : null}
      {failed ? <p role="alert" className="mt-3 text-danger">{common("error")}</p> : null}

      <Dialog open={codes !== null} onClose={() => setCodes(null)} title={t("newCodesTitle")}>
        {codes ? (
          <div>
            <p className="mb-3 text-fg-muted">{t("newCodesBody")}</p>
            <ul className="mb-4 columns-2 rounded-md bg-surface p-4 font-mono" data-testid="recovery-codes">
              {codes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => downloadTextFile("scollarly-recovery-codes.txt", `${codes.join("\n")}\n`)}>
                {t("download")}
              </Button>
              <Button onClick={() => setCodes(null)}>{t("codesSaved")}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
