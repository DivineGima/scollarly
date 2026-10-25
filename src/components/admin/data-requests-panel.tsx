"use client";


import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { FieldError, Input, Label } from "./ui/input";
import { DataStatus, useAdminData } from "./use-admin-data";

interface DataRequest {
  id: string;
  kind: "export" | "erasure";
  channel: "portal" | "whatsapp" | "other";
  status: "open" | "done" | "rejected";
  createdAt: string;
  completedAt: string | null;
  handledBy: string | null;
  lead: { id: string; ref: string; erased: boolean } | null;
  accountLeads: { id: string; ref: string }[];
}

const REF = /^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

/** B5: export and erasure requests, whether they came from the student portal or were logged here for someone who asked on WhatsApp. */
export function DataRequestsPanel() {
  const t = useTranslations("admin.dataRequests");
  const common = useTranslations("admin.common");
  const id = useId();
  const [scope, setScope] = useState<"open" | "all">("open");
  const { state, reload } = useAdminData<{ requests: DataRequest[] }>(`/api/v1/admin/data-requests?status=${scope}`);
  const [logging, setLogging] = useState(false);
  const [kind, setKind] = useState<"export" | "erasure">("erasure");
  const [channel, setChannel] = useState<"whatsapp" | "other">("whatsapp");
  const [ref, setRef] = useState("");
  const [erasing, setErasing] = useState<{ request: DataRequest; leadId: string; leadRef: string } | null>(null);
  const [identity, setIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeAll() {
    setLogging(false);
    setErasing(null);
    setIdentity(false);
    setError(null);
  }

  async function post(path: string, body: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await api("POST", `/api/v1/admin/${path}`, body);
    setBusy(false);
    if (result.ok) return true;
    if (result.status === 401) window.location.replace("/sign-in");
    const token = Object.values(result.fields)[0];
    setError(result.status === 0 ? "network" : token && t.has(`errors.${token}`) ? token : result.code === "CONFLICT" ? "conflict" : "generic");
    return false;
  }

  const refValid = REF.test(ref.trim().toUpperCase());

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("intro")}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => { setError(null); setRef(""); setLogging(true); }}>{t("log")}</Button>
        <label className="flex items-center gap-2">
          <span className="font-semibold">{t("show")}</span>
          <select className="min-h-11 rounded-md border border-border bg-bg px-3" value={scope} onChange={(event) => setScope(event.target.value === "all" ? "all" : "open")}>
            <option value="open">{t("scopeOpen")}</option>
            <option value="all">{t("scopeAll")}</option>
          </select>
        </label>
      </div>

      <div className="mt-6">
        <DataStatus state={state} reload={reload} />
      </div>

      {state.status === "ready" ? (
        state.data.requests.length === 0 ? (
          <p className="text-fg-muted">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {state.data.requests.map((request) => {
              const open = request.status === "open";
              const targets = request.lead ? (request.lead.erased ? [] : [{ id: request.lead.id, ref: request.lead.ref }]) : request.accountLeads;
              return (
                <li key={request.id} className="rounded-lg border border-border p-4">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t(`kinds.${request.kind}`)}</span>
                    <Badge variant={open ? "warning" : "success"}>{t(`statuses.${request.status}`)}</Badge>
                    <span className="text-fg-muted">{t(`channels.${request.channel}`)}</span>
                  </p>
                  <p className="mt-1">
                    {request.lead ? (
                      <a className="font-semibold text-accent underline" href={`/admin/leads/${request.lead.id}`}>
                        {request.lead.ref}
                      </a>
                    ) : (
                      <span className="text-fg-muted">{t("account")}</span>
                    )}
                    {request.lead?.erased ? <span className="text-fg-muted"> · {t("alreadyErased")}</span> : null}
                  </p>
                  <p className="text-sm text-fg-muted">
                    {formatWat(new Date(request.createdAt))}
                    {request.completedAt ? ` · ${t("doneBy", { name: request.handledBy || t("someone"), time: formatWat(new Date(request.completedAt)) })}` : ""}
                  </p>
                  {open ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {request.kind === "erasure"
                        ? targets.map((target) => (
                            <Button key={target.id} variant="destructive" onClick={() => { setError(null); setIdentity(false); setErasing({ request, leadId: target.id, leadRef: target.ref }); }}>
                              {t("runErasure", { ref: target.ref })}
                            </Button>
                          ))
                        : null}
                      {request.kind === "export" || targets.length === 0 ? (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void post("dataRequests.complete", { id: request.id }).then((ok) => ok && reload())}
                        >
                          {t("markDone")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      {error && !logging && !erasing ? <FieldError>{t(`errors.${error}`)}</FieldError> : null}

      <Dialog open={logging} onClose={closeAll} title={t("logTitle")}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!refValid) return;
            void post("dataRequests.log", { kind, channel, leadRef: ref.trim().toUpperCase() }).then((ok) => {
              if (ok) {
                closeAll();
                reload();
              }
            });
          }}
        >
          <Label htmlFor={`${id}-kind`}>{t("form.kind")}</Label>
          <select id={`${id}-kind`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={kind} onChange={(event) => setKind(event.target.value === "export" ? "export" : "erasure")}>
            <option value="erasure">{t("kinds.erasure")}</option>
            <option value="export">{t("kinds.export")}</option>
          </select>
          <Label className="mt-3" htmlFor={`${id}-channel`}>
            {t("form.channel")}
          </Label>
          <select id={`${id}-channel`} className="min-h-11 w-full rounded-md border border-border bg-bg px-3" value={channel} onChange={(event) => setChannel(event.target.value === "other" ? "other" : "whatsapp")}>
            <option value="whatsapp">{t("channels.whatsapp")}</option>
            <option value="other">{t("channels.other")}</option>
          </select>
          <Label className="mt-3" htmlFor={`${id}-ref`}>
            {t("form.ref")}
          </Label>
          <Input id={`${id}-ref`} value={ref} maxLength={20} autoComplete="off" aria-invalid={ref !== "" && !refValid} onChange={(event) => setRef(event.target.value)} />
          {ref !== "" && !refValid ? <FieldError>{t("errors.INVALID")}</FieldError> : null}
          {error ? <FieldError>{t(`errors.${error}`)}</FieldError> : null}
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy || !refValid}>
              {t("form.submit")}
            </Button>
            <Button variant="outline" onClick={closeAll}>
              {common("cancel")}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={erasing !== null} onClose={closeAll} title={t("eraseTitle")}>
        {erasing ? (
          <>
            <p>{t("eraseWarning", { ref: erasing.leadRef })}</p>
            <label className="mt-4 flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-5" checked={identity} onChange={(event) => setIdentity(event.target.checked)} />
              <span>{t("identity")}</span>
            </label>
            {error ? <FieldError>{t(`errors.${error}`)}</FieldError> : null}
            <div className="mt-4 flex gap-2">
              <Button
                variant="destructive"
                disabled={busy || !identity}
                onClick={() =>
                  void post("leads.eraseLead", { leadId: erasing.leadId, identityConfirmed: true, dataRequestId: erasing.request.id }).then((ok) => {
                    if (ok) {
                      closeAll();
                      reload();
                    }
                  })
                }
              >
                {t("eraseConfirm")}
              </Button>
              <Button variant="outline" onClick={closeAll}>
                {common("cancel")}
              </Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
