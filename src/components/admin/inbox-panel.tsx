"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { INBOX_REFRESH_EVENT } from "@/components/notifications/events";
import { PageIntro } from "@/components/shell/page-intro";
import { formatWat } from "@/lib/time";
import { isInboxSection, sectionsFor, totalNeedingAction, type InboxResult, type InboxSection } from "@/modules/inbox/sections";
import { SUGGEST_CLOSE_AFTER_DAYS } from "@/modules/pipeline/steps";
import { useAdminSession } from "./admin-shell";
import { Badge } from "./ui/badge";
import { DataStatus, useAdminData } from "./use-admin-data";

/** The `?section=` of the address, read in the browser (the shell is the same HTML for everyone). */
function sectionFromAddress(allowed: readonly InboxSection[]): InboxSection {
  const value = new URLSearchParams(window.location.search).get("section") ?? "";
  return isInboxSection(value) && allowed.includes(value) ? value : (allowed[0] as InboxSection);
}

/**
 * The Inbox (S18.1; architecture 24.9, 24.10; PRD_5 FR-51): one data call gives every section's count and the rows of the open section. The summary
 * line is the day's count of students who need an action. When the shell's timer sees the unread count rise it fires `INBOX_REFRESH_EVENT`, and the
 * open section fetches itself again without a reload; the list that is on screen stays until the new one arrives.
 */
export function InboxPanel() {
  const t = useTranslations("admin.inbox");
  const steps = useTranslations("admin.inbox.step");
  const session = useAdminSession();
  const allowed = sectionsFor(session.role);
  const [section, setSection] = useState<InboxSection | null>(null);
  const [last, setLast] = useState<InboxResult | null>(null);
  const { state, reload } = useAdminData<InboxResult>(section === null ? null : `/api/v1/admin/inbox?section=${section}`);

  useEffect(() => setSection(sectionFromAddress(allowed)), []); // eslint-disable-line react-hooks/exhaustive-deps -- read once from the address
  useEffect(() => {
    window.addEventListener(INBOX_REFRESH_EVENT, reload);
    return () => window.removeEventListener(INBOX_REFRESH_EVENT, reload);
  }, [reload]);
  useEffect(() => {
    if (state.status === "ready") setLast(state.data);
  }, [state]);

  function choose(next: InboxSection) {
    if (next === section) return;
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(null, "", url);
  }

  const shown = state.status === "ready" ? state.data : last;
  return (
    <section>
      <PageIntro title={t("title")} purpose={t("purpose")} />
      {shown ? (
        <p className="font-semibold" data-testid="inbox-summary" role="status">
          {t("summary", { count: totalNeedingAction(shown.counts, session.role) })}
        </p>
      ) : null}

      <nav aria-label={t("sections")} className="mt-3">
        <ul className="flex flex-wrap gap-2">
          {allowed.map((key) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => choose(key)}
                aria-current={section === key ? "true" : undefined}
                data-testid={`inbox-tab-${key}`}
                className="rounded-full border border-border px-3 py-1.5 font-semibold aria-[current=true]:bg-accent aria-[current=true]:text-accent-fg"
              >
                {t(`section.${key}`)}
                {shown ? <span className="ms-2 text-sm">{shown.counts[key]}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {section ? <p className="mt-3 text-fg-muted">{t(`about.${section}`)}</p> : null}

      {state.status !== "ready" && (shown === null || shown.section !== section || state.status === "error") ? <DataStatus state={state} reload={reload} /> : null}
      {shown ? (
        shown.section === section && shown.rows.length === 0 ? (
          <p className="mt-4 text-fg-muted" data-testid="inbox-empty">
            {t("empty")}
          </p>
        ) : shown.section === section ? (
          <>
            <ul className="mt-3 space-y-3" data-testid="inbox-list">
              {shown.rows.map((row) => (
                <li key={row.id} className="rounded-lg border border-border p-4" data-testid="inbox-row">
                  <a className="font-semibold text-accent underline" href={`/admin/leads/${row.id}`}>
                    {row.name?.trim() || t("noName")}
                  </a>
                  <p className="text-sm text-fg-muted">
                    {row.ref} · {steps(row.stageCode as never)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span>{t(shown.section === "overdue" ? "dueSince" : "since", { when: formatWat(new Date(row.at)) })}</span>
                    {row.waiting !== null ? <Badge variant="warning">{t("waiting", { count: row.waiting })}</Badge> : null}
                    {row.idleDays !== null ? <Badge variant="warning">{t("idle", { days: row.idleDays })}</Badge> : null}
                    {row.idleDays !== null && row.idleDays >= SUGGEST_CLOSE_AFTER_DAYS && session.role === "admin" ? <Badge variant="danger">{t("suggestClose")}</Badge> : null}
                  </p>
                </li>
              ))}
            </ul>
            {shown.more ? (
              <p className="mt-3 text-sm text-fg-muted" data-testid="inbox-more">
                {t("more", { shown: shown.rows.length })}
              </p>
            ) : null}
          </>
        ) : null
      ) : null}
    </section>
  );
}
