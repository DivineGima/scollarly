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
  const [away, setAway] = useState(session.away === true);
  const [number, setNumber] = useState(session.whatsapp ?? "");
  const [availability, setAvailability] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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

  /** The away switch and the WhatsApp number (architecture 24.3). An empty number clears it; anything else must be a full international number. */
  async function saveAvailability(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const typed = number.replace(/[\s-]/g, "");
    if (typed !== "" && !/^[+][1-9][0-9]{6,14}$/.test(typed)) {
      setAvailability({ kind: "error", text: t("availability.errorNumber") });
      return;
    }
    setBusy(true);
    setAvailability(null);
    const result = await api("POST", "/api/v1/admin/staff.settings", { away, whatsapp: typed === "" ? null : typed });
    setBusy(false);
    if (result.ok) {
      setNumber(typed);
      setAvailability({ kind: "ok", text: t("availability.saved") });
    } else setAvailability({ kind: "error", text: result.fields.whatsapp ? t("availability.errorNumber") : t("errorGeneric") });
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
          {t("roleLabel")}: {session.role === "admin" ? t("roleAdmin") : t("roleManager")}
        </p>
        <Button type="submit" disabled={busy || name.trim() === ""}>
          {t("save")}
        </Button>
        {message?.kind === "ok" ? <p role="status" className="text-success">{message.text}</p> : null}
        {message?.kind === "error" ? <FieldError>{message.text}</FieldError> : null}
      </form>

      <form onSubmit={(event) => void saveAvailability(event)} noValidate className="mt-10 max-w-md space-y-4" aria-labelledby={`${id}-availability`} data-testid="availability-form">
        <h2 id={`${id}-availability`} className="text-xl font-semibold">
          {t("availability.title")}
        </h2>
        <p className="text-fg-muted">{t("availability.about")}</p>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={away} onChange={(event) => setAway(event.target.checked)} disabled={busy} className="h-5 w-5" />
          <span>{t("availability.away")}</span>
        </label>
        <div>
          <Label htmlFor={`${id}-number`}>{t("availability.number")}</Label>
          <Input id={`${id}-number`} type="tel" inputMode="tel" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="+237..." autoComplete="tel" disabled={busy} aria-invalid={availability?.kind === "error" ? true : undefined} />
        </div>
        <Button type="submit" disabled={busy}>
          {t("availability.save")}
        </Button>
        {availability?.kind === "ok" ? <p role="status" className="text-success">{availability.text}</p> : null}
        {availability?.kind === "error" ? <FieldError>{availability.text}</FieldError> : null}
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
