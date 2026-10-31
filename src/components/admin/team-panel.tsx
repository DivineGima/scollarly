"use client";

import { PageIntro } from "@/components/shell/page-intro";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { api, type ApiFail } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { useAdminSession } from "./admin-shell";
import { useStepUp } from "./step-up";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { ScrollRegion } from "./ui/scroll-region";
import { FieldError, Input, Label } from "./ui/input";
import { DataStatus, useAdminData } from "./use-admin-data";

interface TeamData {
  members: { userId: string; email: string; name: string; role: "admin" | "owner"; leadsHeld: number; since: string; isYou: boolean }[];
  invites: { id: string; email: string; createdAt: string; expiresAt: string; state: "open" | "expired" }[];
}

type Member = TeamData["members"][number];

/** C2: admins and pending invites, invite (a copyable link, no email is sent), resend, revoke, remove. */
export function TeamPanel() {
  const t = useTranslations("admin.team");
  const common = useTranslations("admin.common");
  const session = useAdminSession();
  const stepUp = useStepUp();
  const { state, reload } = useAdminData<TeamData>(session.role === "owner" ? "/api/v1/admin/team" : null);
  const id = useId();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  function errorText(result: ApiFail): string {
    if (result.fields.email === "ALREADY_STAFF") return t("errorAlreadyStaff");
    if (result.code === "VALIDATION") return t("errorEmail");
    if (result.code === "CONFLICT") return t("errorConflict");
    return t("errorGeneric");
  }

  function openInvite(prefill = "") {
    setEmail(prefill);
    setError(null);
    setLink(null);
    setCopied(false);
    setInviteOpen(true);
  }

  async function createInvite(address: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await stepUp(() => api<{ link: string }>("POST", "/api/v1/admin/team.invite", { email: address }));
    setBusy(false);
    if (result.ok) setLink(result.data.link);
    else setError(errorText(result));
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard permission: select the text so the person can copy it by hand.
      linkField.current?.select();
    }
  }

  async function revoke(inviteId: string) {
    setBusy(true);
    await api("POST", "/api/v1/admin/team.revokeInvite", { id: inviteId });
    setBusy(false);
    reload();
  }

  async function confirmRemove() {
    if (!removing || busy) return;
    setBusy(true);
    setError(null);
    const result = await stepUp(() => api("POST", "/api/v1/admin/team.removeAdmin", { userId: removing.userId }));
    setBusy(false);
    if (result.ok || result.status === 404) {
      setRemoving(null);
      reload();
    } else setError(t("errorGeneric"));
  }

  if (session.role !== "owner") return null;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageIntro title={t("title")} purpose={t("purpose")} />
        <Button onClick={() => openInvite()}>{t("invite")}</Button>
      </div>

      <DataStatus state={state} reload={reload} />
      {state.status === "ready" ? (
        <>
          <h2 className="mt-8 text-xl font-semibold">{t("admins")}</h2>
          <ScrollRegion label={t("admins")} className="mt-3">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-sm text-fg-muted">
                  <th className="py-2 pr-4">{t("colName")}</th>
                  <th className="py-2 pr-4">{t("colEmail")}</th>
                  <th className="py-2 pr-4">{t("colRole")}</th>
                  <th className="py-2 pr-4">{t("colLeads")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {state.data.members.map((member) => (
                  <tr key={member.userId} className="border-b border-border">
                    <td className="py-2 pr-4">
                      {member.name} {member.isYou ? <span className="text-fg-muted">({common("you")})</span> : null}
                    </td>
                    <td className="py-2 pr-4 break-all">{member.email}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={member.role === "owner" ? "owner" : "default"}>{member.role === "owner" ? t("roleOwner") : t("roleAdmin")}</Badge>
                    </td>
                    <td className="py-2 pr-4">{member.leadsHeld}</td>
                    <td className="py-2 text-right">
                      {member.role === "admin" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setError(null);
                            setRemoving(member);
                          }}
                        >
                          {t("remove")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <h2 className="mt-8 text-xl font-semibold">{t("invites")}</h2>
          {state.data.invites.length === 0 ? (
            <p className="mt-3 text-fg-muted">{t("noInvites")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {state.data.invites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <p className="break-all font-semibold">{invite.email}</p>
                    <p className="text-sm text-fg-muted">
                      {invite.state === "expired" ? <Badge variant="warning">{t("expired")}</Badge> : t("expires", { date: formatWat(new Date(invite.expiresAt)) })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => { openInvite(invite.email); void createInvite(invite.email); }}>
                      {t("resend")}
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void revoke(invite.id)}>
                      {t("revoke")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <Dialog
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          if (link) reload();
        }}
        title={link ? t("linkTitle") : t("inviteTitle")}
      >
        {link ? (
          <div>
            <p className="mb-3 text-fg-muted">{t("linkBody")}</p>
            <Input ref={linkField} readOnly value={link} aria-label={t("linkTitle")} onFocus={(event) => event.currentTarget.select()} />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => void copyLink()}>{t("copyLink")}</Button>
              {copied ? <span role="status" className="text-success">{t("linkCopied")}</span> : null}
              <Button
                variant="ghost"
                onClick={() => {
                  setInviteOpen(false);
                  reload();
                }}
              >
                {common("close")}
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createInvite(email);
            }}
            noValidate
          >
            <p className="mb-4 text-fg-muted">{t("inviteBody")}</p>
            <Label htmlFor={`${id}-email`}>{t("emailLabel")}</Label>
            <Input
              id={`${id}-email`}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              disabled={busy}
            />
            {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
            <div className="mt-4 flex gap-3">
              <Button type="submit" disabled={busy || email.trim() === ""}>
                {t("sendInvite")}
              </Button>
              <Button variant="ghost" onClick={() => setInviteOpen(false)}>
                {common("cancel")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog open={removing !== null} onClose={() => setRemoving(null)} title={t("removeTitle")}>
        {removing ? (
          <div>
            <p className="mb-1 break-all font-semibold">{removing.email}</p>
            <p className="mb-4 text-fg-muted">{t("removeBody", { count: removing.leadsHeld })}</p>
            {error ? <FieldError>{error}</FieldError> : null}
            <div className="mt-4 flex gap-3">
              <Button variant="destructive" disabled={busy} onClick={() => void confirmRemove()}>
                {t("removeConfirm")}
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                {common("cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
