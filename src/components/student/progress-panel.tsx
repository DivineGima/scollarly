"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every signed-in screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { watDateString } from "@/lib/time";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { clearProgressSnapshot, readProgressSnapshot, saveProgressSnapshot } from "@/offline/progress-snapshot";
import type { ProgressSnapshot } from "@/offline/db";
import { Offline } from "./offline-view";
import { MeStatus, useMeData } from "./use-me-data";

interface ProgressData {
  userId: string;
  state: "linked" | "matching";
  pendingClaims: number;
  stages: { code: string; position: number }[];
  lead: { ref: string; stage: string; updatedAt: string } | null;
  otherLeads: number;
  whatsappE164: string | null;
}

/** A11: where the student's application stands. Online it reads the portal; offline it shows the last stage kept on the phone. */
export function ProgressPanel() {
  const t = useTranslations("me.progress");
  const { state, reload } = useMeData<ProgressData>("/api/v1/me/progress");
  const [kept, setKept] = useState<ProgressSnapshot | null | undefined>(undefined);

  // Every online render refreshes the snapshot (S8.1). A student with nothing linked yet has nothing to keep, and a different
  // student's record is replaced, so one phone never shows another person's progress.
  useEffect(() => {
    if (state.status !== "ready") return;
    const { userId, lead } = state.data;
    if (lead) void saveProgressSnapshot({ userId, leadRef: lead.ref, stageCode: lead.stage, updatedAt: new Date(lead.updatedAt).getTime() });
    else void clearProgressSnapshot();
  }, [state]);

  // When the request never reached the server, look for the copy on the phone.
  useEffect(() => {
    if (state.status === "error" && state.offline) void readProgressSnapshot().then(setKept);
  }, [state]);

  if (state.status === "ready") return <Ready data={state.data} />;
  if (state.status === "error" && state.offline && kept) return <Offline snapshot={kept} retry={reload} />;
  return (
    <section>
      <h1>{t("title")}</h1>
      <MeStatus state={state} reload={reload} />
    </section>
  );
}

function Ready({ data }: { data: ProgressData }) {
  const t = useTranslations("me.progress");
  const stages = useTranslations("me.stages");
  const next = useTranslations("me.next");

  if (data.state === "matching" || !data.lead) {
    return (
      <section>
        <h1>{t("title")}</h1>
        <div className="me-card" data-testid="matching">
          <h2>{t("matching.title")}</h2>
          <p>{t("matching.body")}</p>
          {data.pendingClaims > 0 ? <p className="me-muted">{t("matching.pending", { count: data.pendingClaims })}</p> : null}
          <a className="me-button" href="/me/link-application">
            {t("matching.link")}
          </a>
        </div>
      </section>
    );
  }

  const { lead } = data;
  const current = data.stages.find((s) => s.code === lead.stage)?.position ?? 1;
  const stageName = stages.has(lead.stage) ? stages(lead.stage) : lead.stage;
  const url = buildWhatsAppUrl(data.whatsappE164, t("whatsappText", { ref: lead.ref, stage: stageName }));
  return (
    <section>
      <h1>{t("title")}</h1>
      <p>
        {t("reference")}: <strong data-testid="reference">{lead.ref}</strong>
      </p>
      <ol className="me-steps" aria-label={t("stepsLabel")} data-testid="stage-bar">
        {data.stages.map((stage) => (
          <li key={stage.code} aria-current={stage.code === lead.stage ? "step" : undefined} data-state={stage.position < current ? "done" : stage.position === current ? "current" : "todo"}>
            <span className="me-step-name">{stages.has(stage.code) ? stages(stage.code) : stage.code}</span>
            <span className="me-step-mark">{stage.position < current ? t("done") : stage.position === current ? t("here") : ""}</span>
          </li>
        ))}
      </ol>
      <div className="me-card">
        <h2>{t("nextTitle")}</h2>
        <p data-testid="next-step">{next.has(lead.stage) ? next(lead.stage) : t("nextFallback")}</p>
        <p className="me-muted" data-testid="last-updated">
          {t("lastUpdated", { date: watDateString(new Date(lead.updatedAt)) })}
        </p>
        {url ? (
          <a className="me-button" href={url} target="_blank" rel="noopener noreferrer" data-testid="whatsapp">
            {t("whatsapp")}
          </a>
        ) : (
          <p className="me-muted">{t("whatsappMissing")}</p>
        )}
      </div>
      {data.otherLeads > 0 ? <p className="me-muted">{t("others", { count: data.otherLeads })}</p> : null}
    </section>
  );
}
