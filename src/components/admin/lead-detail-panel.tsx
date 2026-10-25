"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { DuplicateDialog } from "./leads/duplicate-dialog";
import { type DuplicatePairData, failureKey, type Person, type Sla, SlaBadge, type StageOption, stageName } from "./leads/shared";
import { Badge } from "./ui/badge";
import { buttonVariants } from "./ui/button";
import { Button } from "./ui/button";
import { cn } from "./ui/cn";
import { Dialog } from "./ui/dialog";
import { FieldError, Label } from "./ui/input";
import { DataStatus, useAdminData } from "./use-admin-data";

interface TimelineItem {
  id: string;
  type: string;
  at: string;
  by: { id: string; label: string } | null;
  data: Record<string, unknown>;
  note?: { body: string | null; erased: boolean };
}

interface LeadDetailData {
  lead: {
    id: string;
    ref: string;
    name: string | null;
    whatsapp: string | null;
    email: string | null;
    country: string;
    intakeKind: string;
    qualificationType: string | null;
    results: { subject: string; grade: string }[];
    locale: string;
    stage: string;
    assigned: Person | null;
    linkedAccount: boolean;
    receivedAt: string;
    sla: Sla;
    slaHours: number;
    firstResponseAt: string | null;
    erased: boolean;
    mergedInto: { id: string; ref: string } | null;
    source: { page: string | null; university: string | null };
    version: string;
  };
  prefs: { rank: number; programmeId: string; programmeName: string; universityName: string }[];
  timeline: TimelineItem[];
  pendingClaims: number;
  duplicates: DuplicatePairData[];
  stages: StageOption[];
  admins: Person[];
  template: string | null;
  you: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The lead's id from the address. The shell is the same for every lead, so it is read in the browser (see `canonicalShellPath`). */
export function leadIdFromPath(pathname: string): string | null {
  return pathname.split("/").filter(Boolean).reverse().find((part) => UUID.test(part) && part.length === 36) ?? null;
}

type Pending = null | "stage" | "assign" | "whatsapp" | "erase";

/** B3: one lead, everything an admin does with it. Every change carries the version it was read at, so a stale screen cannot overwrite someone else's change (S5.6). */
export function LeadDetailPanel() {
  const t = useTranslations("admin.lead");
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => setId(leadIdFromPath(window.location.pathname)), []);
  const { state, reload } = useAdminData<LeadDetailData>(id ? `/api/v1/admin/lead?id=${id}` : null);

  // The last good copy stays on screen while a fresh one is read, so a dialog, a note being typed and the "Did you send it?"
  // chip survive every change (a reload after each save would otherwise unmount them).
  const [shown, setShown] = useState<LeadDetailData | null>(null);
  useEffect(() => {
    if (state.status === "ready") setShown(state.data);
  }, [state]);

  if (id === null) return <p role="alert">{t("notFound")}</p>;
  if (state.status === "error" && state.httpStatus === 404) return <p role="alert">{t("notFound")}</p>;
  if (!shown) return <DataStatus state={state} reload={reload} />;
  return (
    <div aria-busy={state.status === "loading"}>
      {state.status === "error" ? <DataStatus state={state} reload={reload} /> : null}
      <LeadDetail data={shown} reload={reload} />
    </div>
  );
}

function LeadDetail({ data, reload }: { data: LeadDetailData; reload: () => void }) {
  const t = useTranslations("admin.lead");
  const common = useTranslations("admin.common");
  const noteId = useId();
  const { lead } = data;
  const editable = !lead.erased && lead.mergedInto === null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Pending>(null);
  const [pickedStage, setPickedStage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [awaiting, setAwaiting] = useState(false);
  const [chip, setChip] = useState(false);
  const [identity, setIdentity] = useState(false);
  const [pair, setPair] = useState<DuplicatePairData | null>(null);

  /** One POST, then a fresh read. A stale version shows the one message of architecture 13.6 and a Reload button. */
  const run = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      const result = await api("POST", `/api/v1/admin/${path}`, body);
      setBusy(false);
      if (result.ok) {
        reload();
        return true;
      }
      if (result.status === 401) window.location.replace("/sign-in");
      setError(failureKey(result));
      return false;
    },
    [busy, reload],
  );

  // B3 step 4: when the tab regains focus after WhatsApp was opened, ask "Did you send it?".
  useEffect(() => {
    if (!awaiting) return;
    const back = () => {
      if (document.visibilityState === "visible") {
        setChip(true);
        setAwaiting(false);
      }
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [awaiting]);

  const firstName = (lead.name ?? "").trim().split(/\s+/)[0] ?? "";
  const university = lead.source.university ?? data.prefs[0]?.universityName ?? "";

  function defaultMessage(): string {
    const fill = (text: string) => text.replaceAll("{name}", firstName).replaceAll("{ref}", lead.ref).replaceAll("{university}", university);
    if (data.template) return fill(data.template);
    const key = `templates.${lead.stage}`;
    return t.has(key) ? t(key, { name: firstName, ref: lead.ref, university }) : t("templates.default", { name: firstName, ref: lead.ref });
  }

  const whatsappUrl = lead.whatsapp ? buildWhatsAppUrl(lead.whatsapp, message) : null;
  const who = (item: TimelineItem) => item.by?.label || (item.by ? t("formerAdmin") : t("system"));
  const adminLabel = (adminId: unknown) => (typeof adminId === "string" ? (data.admins.find((a) => a.id === adminId)?.label ?? t("formerAdmin")) : null);

  function describe(item: TimelineItem): string {
    const d = item.data;
    switch (item.type) {
      case "stage_changed":
        return t("events.stage_changed", { who: who(item), from: stageName(data.stages, String(d.from ?? "")), to: stageName(data.stages, String(d.to ?? "")) });
      case "assigned": {
        const to = adminLabel(d.to);
        return to ? t("events.assigned", { who: who(item), to }) : t("events.unassigned", { who: who(item) });
      }
      case "reply_logged":
        return t(d.first === true ? "events.replyFirst" : "events.reply_logged", { who: who(item) });
      case "claimed":
        return t("events.claimed", { who: who(item), method: t(`methods.${String(d.verification_method ?? "email_match")}`) });
      case "created":
        return t("events.created");
      case "note":
        return t("events.note", { who: who(item) });
      default:
        return t.has(`events.${item.type}`) ? t(`events.${item.type}`, { who: who(item) }) : item.type;
    }
  }

  return (
    <section>
      <p>
        <a className="text-accent underline" href="/admin/leads">
          {t("back")}
        </a>
      </p>

      {lead.mergedInto ? (
        <p role="status" className="mt-4 rounded-md border border-border p-3">
          {t("mergedInto", { ref: lead.mergedInto.ref })}{" "}
          <a className="text-accent underline" href={`/admin/leads/${lead.mergedInto.id}`}>
            {t("openMerged")}
          </a>
        </p>
      ) : null}
      {lead.erased ? (
        <p role="status" className="mt-4 rounded-md border border-border p-3">
          {t("erasedBanner")}
        </p>
      ) : null}

      <header className="mt-4">
        <h1 className="text-2xl font-semibold">{lead.erased ? t("erasedName") : lead.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-semibold">{lead.ref}</span>
          <span>{lead.country}</span>
          <Badge>{stageName(data.stages, lead.stage)}</Badge>
          {lead.erased ? null : <SlaBadge sla={lead.sla} />}
          <span className="text-fg-muted">{lead.assigned ? t("assignedTo", { name: lead.assigned.label || t("formerAdmin") }) : t("unassigned")}</span>
        </p>
      </header>

      {error ? (
        <div role="alert" className="mt-4 rounded-md border border-danger p-3 text-danger">
          <p>{t(`errors.${error}`)}</p>
          {error === "stale" || error === "unavailable" ? (
            <Button className="mt-2" variant="outline" onClick={() => { setError(null); reload(); }}>
              {t("reload")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {data.duplicates.length > 0 && editable ? (
        <div className="mt-4 space-y-2">
          {data.duplicates.map((d) => {
            const other = d.a.id === lead.id ? d.b : d.a;
            return (
              <button key={other.id} type="button" onClick={() => setPair(d)} className="block w-full rounded-md border border-warning bg-surface p-3 text-left font-semibold text-warning hover:opacity-90">
                {t("duplicate.banner", { ref: other.ref })}
              </button>
            );
          })}
        </div>
      ) : null}

      {data.pendingClaims > 0 ? (
        <p className="mt-4">
          <a className="text-accent underline" href="/admin/leads/link-requests">
            {t("pendingClaims", { count: data.pendingClaims })}
          </a>
        </p>
      ) : null}

      {chip ? (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3">
          <span className="font-semibold">{t("chip.question")}</span>
          <Button size="sm" disabled={busy} onClick={() => void run("leads.logReply", { leadId: lead.id }).then((ok) => ok && setChip(false))}>
            {t("chip.yes")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setChip(false)}>
            {t("chip.no")}
          </Button>
        </div>
      ) : null}

      {editable ? (
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <Button disabled={busy} onClick={() => void run("leads.logReply", { leadId: lead.id })}>
            {busy ? t("saving") : t("actions.logReply")}
          </Button>
          <Button
            variant="outline"
            disabled={!lead.whatsapp}
            onClick={() => {
              setMessage(defaultMessage());
              setDialog("whatsapp");
            }}
          >
            {t("actions.whatsapp")}
          </Button>
          <div>
            <Label htmlFor={`${noteId}-stage`}>{t("actions.changeStage")}</Label>
            <select
              id={`${noteId}-stage`}
              className="min-h-11 rounded-md border border-border bg-bg px-3"
              value={lead.stage}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value === lead.stage) return;
                setPickedStage(event.target.value);
                setDialog("stage");
              }}
            >
              {data.stages.map((s) => (
                <option key={s.code} value={s.code}>
                  {stageName(data.stages, s.code)}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" disabled={busy} onClick={() => setDialog("assign")}>
            {t("actions.assign")}
          </Button>
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold">{t("profile.title")}</h2>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-fg-muted">{t("profile.whatsapp")}</dt>
            <dd>{lead.whatsapp ?? "—"}</dd>
            <dt className="text-fg-muted">{t("profile.email")}</dt>
            <dd className="break-all">{lead.email ?? "—"}</dd>
            <dt className="text-fg-muted">{t("profile.intake")}</dt>
            <dd>{t(`profile.intakeKinds.${lead.intakeKind}`)}</dd>
            <dt className="text-fg-muted">{t("profile.qualification")}</dt>
            <dd>{lead.qualificationType ? t(`profile.qualifications.${lead.qualificationType}`) : "—"}</dd>
            <dt className="text-fg-muted">{t("profile.source")}</dt>
            <dd>{[lead.source.university, lead.source.page].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="text-fg-muted">{t("profile.account")}</dt>
            <dd>{lead.linkedAccount ? t("profile.accountLinked") : t("profile.accountNone")}</dd>
            <dt className="text-fg-muted">{t("profile.received")}</dt>
            <dd>{formatWat(new Date(lead.receivedAt))}</dd>
            <dt className="text-fg-muted">{t("profile.firstReply")}</dt>
            <dd>{lead.firstResponseAt ? formatWat(new Date(lead.firstResponseAt)) : t("profile.noReply")}</dd>
          </dl>

          <h3 className="mt-6 text-lg font-semibold">{t("results.title")}</h3>
          {lead.results.length === 0 ? (
            <p className="text-fg-muted">{t("results.none")}</p>
          ) : (
            <ul className="mt-2 list-disc pl-5">
              {lead.results.map((r, index) => (
                <li key={`${r.subject}-${index}`}>
                  {r.subject}: {r.grade}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 text-lg font-semibold">{t("prefs.title")}</h3>
          {data.prefs.length === 0 ? (
            <p className="text-fg-muted">{t("prefs.none")}</p>
          ) : (
            <ol className="mt-2 list-decimal pl-5">
              {data.prefs.map((p) => (
                <li key={p.programmeId}>
                  {p.programmeName} <span className="text-fg-muted">· {p.universityName}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h2 className="text-xl font-semibold">{t("notes.title")}</h2>
          {editable ? (
            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                const body = note.trim();
                if (!body) return;
                void run("leads.addNote", { leadId: lead.id, body }).then((ok) => ok && setNote(""));
              }}
            >
              <Label htmlFor={`${noteId}-note`}>{t("notes.label")}</Label>
              <textarea
                id={`${noteId}-note`}
                className="min-h-24 w-full rounded-md border border-border bg-bg p-3 text-base"
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button className="mt-2" type="submit" disabled={busy || note.trim() === ""}>
                {t("notes.add")}
              </Button>
            </form>
          ) : null}

          <h2 className="mt-8 text-xl font-semibold">{t("timeline.title")}</h2>
          {data.timeline.length === 0 ? (
            <p className="text-fg-muted">{t("timeline.empty")}</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {data.timeline.map((item) => (
                <li key={item.id} className="border-l-2 border-border pl-3">
                  <p>{describe(item)}</p>
                  {item.note ? <p className="mt-1 whitespace-pre-wrap rounded-md bg-surface p-2">{item.note.erased || item.note.body === null ? <span className="text-fg-muted">{t("notes.erased")}</span> : item.note.body}</p> : null}
                  <p className="text-sm text-fg-muted">{formatWat(new Date(item.at))}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {editable ? (
        <p className="mt-10">
          <Button variant="outline" onClick={() => { setIdentity(false); setDialog("erase"); }}>
            {t("actions.erase")}
          </Button>
        </p>
      ) : null}

      <Dialog open={dialog === "stage"} onClose={() => setDialog(null)} title={t("stage.title")}>
        <p>{t("stage.confirm", { stage: pickedStage ? stageName(data.stages, pickedStage) : "" })}</p>
        <div className="mt-4 flex gap-2">
          <Button
            disabled={busy || !pickedStage}
            onClick={() => void run("leads.changeStage", { leadId: lead.id, stage: pickedStage, version: lead.version }).then(() => setDialog(null))}
          >
            {t("stage.move")}
          </Button>
          <Button variant="outline" onClick={() => setDialog(null)}>
            {common("cancel")}
          </Button>
        </div>
      </Dialog>

      <Dialog open={dialog === "assign"} onClose={() => setDialog(null)} title={t("assign.title")}>
        <ul className="space-y-2">
          <li>
            <Button
              className="w-full"
              disabled={busy || lead.assigned?.id === data.you}
              onClick={() => void run("leads.assign", { leadId: lead.id, adminId: data.you, version: lead.version }).then(() => setDialog(null))}
            >
              {t("assign.me")}
            </Button>
          </li>
          {data.admins
            .filter((a) => a.id !== data.you)
            .map((a) => (
              <li key={a.id}>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy || lead.assigned?.id === a.id}
                  onClick={() => void run("leads.assign", { leadId: lead.id, adminId: a.id, version: lead.version }).then(() => setDialog(null))}
                >
                  {a.label}
                </Button>
              </li>
            ))}
          {lead.assigned ? (
            <li>
              <Button
                className="w-full"
                variant="ghost"
                disabled={busy}
                onClick={() => void run("leads.assign", { leadId: lead.id, adminId: null, version: lead.version }).then(() => setDialog(null))}
              >
                {t("assign.unassign")}
              </Button>
            </li>
          ) : null}
        </ul>
        <Button className="mt-4" variant="outline" onClick={() => setDialog(null)}>
          {common("cancel")}
        </Button>
      </Dialog>

      <Dialog open={dialog === "whatsapp"} onClose={() => setDialog(null)} title={t("drawer.title")}>
        <p className="text-fg-muted">{t("drawer.help")}</p>
        <Label className="mt-4" htmlFor={`${noteId}-message`}>
          {t("drawer.message")}
        </Label>
        <textarea id={`${noteId}-message`} className="min-h-32 w-full rounded-md border border-border bg-bg p-3 text-base" maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} />
        <div className="mt-4 flex gap-2">
          {whatsappUrl ? (
            <a
              className={cn(buttonVariants())}
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                // B3 step 3: logged when WhatsApp opens; a failed log never blocks the chat.
                void api("POST", "/api/v1/admin/leads.logAdminWhatsAppOpen", { leadId: lead.id }).then(() => reload());
                setAwaiting(true);
                setDialog(null);
              }}
            >
              {t("drawer.open")}
            </a>
          ) : (
            <p className="text-danger">{t("drawer.noNumber")}</p>
          )}
          <Button variant="outline" onClick={() => setDialog(null)}>
            {common("cancel")}
          </Button>
        </div>
      </Dialog>

      <Dialog open={dialog === "erase"} onClose={() => setDialog(null)} title={t("erase.title")}>
        <p>{t("erase.warning")}</p>
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-5" checked={identity} onChange={(event) => setIdentity(event.target.checked)} />
          <span>{t("erase.identity")}</span>
        </label>
        {error === "stale" || error === "generic" ? <FieldError>{t(`errors.${error}`)}</FieldError> : null}
        <div className="mt-4 flex gap-2">
          <Button
            variant="destructive"
            disabled={busy || !identity}
            onClick={() => void run("leads.eraseLead", { leadId: lead.id, identityConfirmed: true }).then((ok) => ok && setDialog(null))}
          >
            {t("erase.confirm")}
          </Button>
          <Button variant="outline" onClick={() => setDialog(null)}>
            {common("cancel")}
          </Button>
        </div>
      </Dialog>

      <DuplicateDialog
        pair={pair}
        stages={data.stages}
        onClose={() => setPair(null)}
        onResolved={() => {
          setPair(null);
          reload();
        }}
      />
    </section>
  );
}
