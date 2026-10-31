"use client";

import { PageIntro } from "@/components/shell/page-intro";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { api } from "@/lib/client/api";
import { useAdminSession } from "./admin-shell";
import { Button } from "./ui/button";
import { FieldError, Input, Label } from "./ui/input";

/** B11: edit the name, sign out, sign out of other devices. The email comes from Google and is not editable. */
export function ProfilePanel() {
  const t = useTranslations("admin.profile");
  const session = useAdminSession();
  const id = useId();
  const [name, setName] = useState(session.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [others, setOthers] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await api("POST", "/api/v1/admin/profile.setName", { name });
    setBusy(false);
    if (result.ok) setMessage({ kind: "ok", text: t("saved") });
    else setMessage({ kind: "error", text: result.code === "VALIDATION" ? t("errorName") : t("errorGeneric") });
  }

  async function signOutOthers() {
    setBusy(true);
    setOthers(null);
    const result = await api<{ ended: number }>("POST", "/api/v1/admin/profile.signOutOthers");
    setBusy(false);
    setOthers(result.ok ? t("signedOutOthers", { count: result.data.ended }) : t("errorGeneric"));
  }

  return (
    <section>
      <PageIntro title={t("title")} purpose={t("purpose")} />
      <form onSubmit={(event) => void save(event)} noValidate className="mt-6 max-w-md space-y-4">
        <div>
          <Label htmlFor={`${id}-name`}>{t("nameLabel")}</Label>
          <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" disabled={busy} />
        </div>
        <div>
          <Label htmlFor={`${id}-email`}>{t("emailLabel")}</Label>
          <Input id={`${id}-email`} value={session.email} readOnly />
        </div>
        <p className="text-fg-muted">
          {t("roleLabel")}: {session.role === "owner" ? t("roleOwner") : t("roleAdmin")}
        </p>
        <Button type="submit" disabled={busy || name.trim() === ""}>
          {t("save")}
        </Button>
        {message?.kind === "ok" ? <p role="status" className="text-success">{message.text}</p> : null}
        {message?.kind === "error" ? <FieldError>{message.text}</FieldError> : null}
      </form>

      <div className="mt-10 flex max-w-md flex-col items-start gap-3">
        <Button variant="outline" onClick={() => void signOutOthers()} disabled={busy}>
          {t("signOutOthers")}
        </Button>
        {others ? <p role="status">{others}</p> : null}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/sign-out" className="inline-flex min-h-11 items-center font-semibold text-accent underline">
          {t("signOut")}
        </a>
      </div>
    </section>
  );
}
