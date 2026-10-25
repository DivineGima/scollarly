"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { FieldError, Input, Label } from "./ui/input";
import { DataStatus, useAdminData } from "./use-admin-data";

interface Claim {
  claimId: string;
  method: string;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
  emailVerified: boolean;
  leadId: string;
  leadRef: string;
  leadName: string | null;
  leadCountry: string;
  emailMatches: boolean;
  linkedToOther: boolean;
}

type Method = "email_match" | "whatsapp_confirmed";
const METHODS: readonly Method[] = ["email_match", "whatsapp_confirmed"];

/** B4: students who asked to link their account to an application. Approving needs how you checked; nothing is linked silently (architecture 9.6). */
export function LinkRequestsPanel() {
  const t = useTranslations("admin.linkRequests");
  const common = useTranslations("admin.common");
  const { state, reload } = useAdminData<{ claims: Claim[] }>("/api/v1/admin/link-requests");
  const [approving, setApproving] = useState<Claim | null>(null);
  const [rejecting, setRejecting] = useState<Claim | null>(null);
  const [method, setMethod] = useState<Method | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setApproving(null);
    setRejecting(null);
    setMethod("");
    setReason("");
    setError(null);
  }

  async function decide(claim: Claim, body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await api("POST", "/api/v1/admin/leads.decideClaim", { claimId: claim.claimId, ...body });
    setBusy(false);
    if (result.ok) {
      close();
      reload();
      return;
    }
    if (result.status === 401) window.location.replace("/sign-in");
    const token = result.fields.verificationMethod ?? result.fields.claim ?? result.fields.lead;
    setError(result.status === 0 ? "network" : token && t.has(`errors.${token}`) ? token : "generic");
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>
      <p className="mt-2">
        <a className="text-accent underline" href="/admin/leads">
          {t("back")}
        </a>
      </p>

      <div className="mt-6">
        <DataStatus state={state} reload={reload} />
      </div>

      {state.status === "ready" ? (
        state.data.claims.length === 0 ? (
          <p className="text-fg-muted">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {state.data.claims.map((claim) => (
              <li key={claim.claimId} className="rounded-lg border border-border p-4">
                <p className="font-semibold">{claim.userName || claim.userEmail || t("unknownStudent")}</p>
                <p className="break-all text-fg-muted">
                  {claim.userEmail} {claim.emailVerified ? null : <Badge variant="warning">{t("emailNotVerified")}</Badge>}
                </p>
                <p className="mt-2">
                  {t("asked", { method: t(`methods.${claim.method}`) })}{" "}
                  <a className="font-semibold text-accent underline" href={`/admin/leads/${claim.leadId}`}>
                    {claim.leadRef}
                  </a>{" "}
                  · {claim.leadName ?? t("erased")} · {claim.leadCountry}
                </p>
                <p className="text-sm text-fg-muted">{formatWat(new Date(claim.createdAt))}</p>
                {claim.emailMatches ? <p className="mt-1 text-success">{t("emailMatches")}</p> : null}
                {claim.linkedToOther ? <p className="mt-1 text-danger">{t("linkedToOther")}</p> : null}
                <div className="mt-3 flex gap-2">
                  <Button disabled={claim.linkedToOther} onClick={() => { setError(null); setMethod(claim.emailMatches ? "email_match" : ""); setApproving(claim); }}>
                    {t("approve")}
                  </Button>
                  <Button variant="outline" onClick={() => { setError(null); setReason(""); setRejecting(claim); }}>
                    {t("reject")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <Dialog open={approving !== null} onClose={close} title={t("approveTitle")}>
        {approving ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (method) void decide(approving, { decision: "approve", verificationMethod: method });
            }}
          >
            <fieldset>
              <legend className="font-semibold">{t("howVerified")}</legend>
              {METHODS.map((m) => (
                <label key={m} className="mt-2 flex items-start gap-3">
                  <input type="radio" name="verification" className="mt-1 size-5" value={m} checked={method === m} onChange={() => setMethod(m)} />
                  <span>{t(`verification.${m}`)}</span>
                </label>
              ))}
            </fieldset>
            {error ? <FieldError>{t(`errors.${error}`)}</FieldError> : null}
            <div className="mt-4 flex gap-2">
              <Button type="submit" disabled={busy || method === ""}>
                {t("approve")}
              </Button>
              <Button variant="outline" onClick={close}>
                {common("cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog open={rejecting !== null} onClose={close} title={t("rejectTitle")}>
        {rejecting ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim()) void decide(rejecting, { decision: "reject", reason: reason.trim() });
            }}
          >
            <Label htmlFor="reject-reason">{t("reason")}</Label>
            <Input id="reject-reason" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
            {error ? <FieldError>{t(`errors.${error}`)}</FieldError> : null}
            <div className="mt-4 flex gap-2">
              <Button type="submit" variant="destructive" disabled={busy || reason.trim() === ""}>
                {t("reject")}
              </Button>
              <Button variant="outline" onClick={close}>
                {common("cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </section>
  );
}
