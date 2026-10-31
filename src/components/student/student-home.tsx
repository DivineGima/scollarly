"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every signed-in screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { PIPELINE_STAGE_CODES } from "@/lib/constants";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { orderUniversities, type CatalogueEntry } from "@/modules/student/ordering";
import type { ProgressSnapshot } from "@/offline/db";
import { clearStageFromSnapshot, hasStage, readProgressSnapshot, saveProfileSnapshot, saveProgressSnapshot } from "@/offline/progress-snapshot";
import { MeStatus, useMeData } from "./use-me-data";
import { UniversityList } from "./university-list";
import { useUniversityLabels } from "./use-university-labels";

interface HomeData {
  userId: string;
  onboarded: boolean;
  firstName: string | null;
  courseFields: string[];
  level: string | null;
  lead: { ref: string; stage: string; updatedAt: string } | null;
  whatsappE164: string | null;
}

/** What the screen needs, whether it came from the server or from the copy kept on the phone. */
interface HomeView {
  firstName: string | null;
  onboarded: boolean;
  courseFields: string[];
  stage: string | null;
  ref: string | null;
  whatsappE164: string | null;
  fromPhone: boolean;
}

const SHORTLIST = 3;

/**
 * The student's Home (architecture 21.4, F16; S13.4): their name, where they are, what happens next, and the universities that fit their
 * course. The list is ordered here from the public catalogue embedded in the page and the person's answers, so no personal data is in any
 * cached page. Offline it shows the copy this phone kept (first name, chosen courses, last stage), and says so.
 */
export function StudentHome({ catalogue }: { catalogue: readonly CatalogueEntry[] }) {
  const { state, reload } = useMeData<HomeData>("/api/v1/me/home");
  const [kept, setKept] = useState<ProgressSnapshot | null | undefined>(undefined);

  // Every online render refreshes what the phone keeps (architecture 21.11): the stage, and the first name and chosen courses.
  useEffect(() => {
    if (state.status !== "ready") return;
    const { userId, lead, firstName, courseFields, level } = state.data;
    void (async () => {
      if (lead) await saveProgressSnapshot({ userId, leadRef: lead.ref, stageCode: lead.stage, updatedAt: new Date(lead.updatedAt).getTime() });
      else await clearStageFromSnapshot(userId);
      await saveProfileSnapshot(userId, { firstName, courseFields, level });
    })();
  }, [state]);

  useEffect(() => {
    if (state.status === "error" && state.offline) void readProgressSnapshot().then(setKept);
  }, [state]);

  if (state.status === "ready") {
    const d = state.data;
    return (
      <HomeBody
        catalogue={catalogue}
        view={{ firstName: d.firstName, onboarded: d.onboarded, courseFields: d.courseFields, stage: d.lead?.stage ?? null, ref: d.lead?.ref ?? null, whatsappE164: d.whatsappE164, fromPhone: false }}
      />
    );
  }
  if (state.status === "error" && state.offline && kept) {
    const stage = hasStage(kept) ? kept.stageCode : null;
    return (
      <HomeBody
        catalogue={catalogue}
        retry={reload}
        view={{ firstName: kept.firstName ?? null, onboarded: (kept.courseFields?.length ?? 0) > 0, courseFields: kept.courseFields ?? [], stage, ref: stage ? kept.leadRef : null, whatsappE164: null, fromPhone: true }}
      />
    );
  }
  return <MeStatus state={state} reload={reload} />;
}

function HomeBody({ catalogue, view, retry }: { catalogue: readonly CatalogueEntry[]; view: HomeView; retry?: () => void }) {
  const t = useTranslations("student.home");
  const me = useTranslations("me");
  const stages = useTranslations("me.stages");
  const next = useTranslations("me.next");
  const courses = useTranslations("courses");
  const { labels, courseNames } = useUniversityLabels();

  const ordered = useMemo(() => orderUniversities(catalogue, view.courseFields), [catalogue, view.courseFields]);
  const stageIndex = view.stage ? PIPELINE_STAGE_CODES.indexOf(view.stage as (typeof PIPELINE_STAGE_CODES)[number]) : -1;
  const stageName = view.stage ? (stages.has(view.stage) ? stages(view.stage) : view.stage) : null;
  const whatsapp = view.ref && stageName ? buildWhatsAppUrl(view.whatsappE164, t("whatsappText", { ref: view.ref, stage: stageName })) : null;
  const chosen = view.courseFields.map((field) => courses(field)).join(", ");

  return (
    <section>
      <h1 className="home-greeting">{view.firstName ? t("greeting", { name: view.firstName }) : t("greetingNoName")}</h1>

      {view.fromPhone ? (
        <p role="status" className="me-notice" data-testid="from-phone">
          {t("offline")}
          {retry ? (
            <>
              {" "}
              <button type="button" className="me-button me-button-quiet" onClick={retry}>
                {me("common.retry")}
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {view.onboarded ? null : (
        <div className="me-card" data-testid="finish-profile">
          <h2>{t("finishProfile.title")}</h2>
          <p>{t("finishProfile.body")}</p>
          <a className="me-button" href="/me/onboarding">
            {t("finishProfile.button")}
          </a>
        </div>
      )}

      <div className="me-card" data-testid="stage-card">
        <h2>{t("stageTitle")}</h2>
        {stageName ? (
          <>
            <p className="home-step">
              {stageName} · {t("stepOf", { position: stageIndex + 1, total: PIPELINE_STAGE_CODES.length })}
            </p>
            <h3>{t("nextTitle")}</h3>
            <p data-testid="next-step">{view.stage && next.has(view.stage) ? next(view.stage) : null}</p>
            {whatsapp ? (
              <a className="me-button" href={whatsapp} target="_blank" rel="noopener noreferrer" data-testid="whatsapp">
                {t("whatsapp")}
              </a>
            ) : view.fromPhone ? null : (
              <p className="me-muted">{t("whatsappMissing")}</p>
            )}
          </>
        ) : (
          <>
            <p>{t("noApplication")}</p>
            <a className="me-button me-button-quiet" href="/me/progress">
              {t("progressLink")}
            </a>
          </>
        )}
      </div>

      <div className="me-card" data-testid="for-you">
        <h2>{t("forYou.title")}</h2>
        <p className="me-muted">{view.courseFields.length > 0 ? t("forYou.subtitle", { courses: chosen }) : t("forYou.subtitleNone")}</p>
        <UniversityList items={ordered.slice(0, SHORTLIST)} courseNames={courseNames} labels={labels} />
        <a className="me-button me-button-quiet" href="/me/universities">
          {t("forYou.seeAll")}
        </a>
      </div>
    </section>
  );
}
