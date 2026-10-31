"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every signed-in screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { COURSE_FIELDS } from "@/lib/courses";
import { orderUniversities, type CatalogueEntry } from "@/modules/student/ordering";
import { readProgressSnapshot, saveProfileSnapshot } from "@/offline/progress-snapshot";
import { MeStatus, useMeData } from "./use-me-data";
import { UniversityList } from "./university-list";
import { useUniversityLabels } from "./use-university-labels";

interface PreferencesData {
  userId: string;
  onboarded: boolean;
  firstName: string | null;
  courseFields: string[];
  level: string | null;
}

/**
 * The Universities tab (architecture 21.7, F16; S13.4). The public catalogue is embedded in this page and is the same for everyone; the
 * person's own courses arrive from `me/preferences` (or from the copy kept on the phone, offline) and are ticked already. Ordering runs
 * here, in the browser: universities offering a ticked course first, then the best NAAC grade, then A to Z. Ticking another course only
 * changes this view; the saved answers are not touched.
 */
export function UniversitiesPanel({ catalogue }: { catalogue: readonly CatalogueEntry[] }) {
  const { state, reload } = useMeData<PreferencesData>("/api/v1/me/preferences");
  const [fromPhone, setFromPhone] = useState<{ courseFields: string[]; onboarded: boolean } | null>(null);

  useEffect(() => {
    if (state.status !== "ready") return;
    const { userId, firstName, courseFields, level } = state.data;
    void saveProfileSnapshot(userId, { firstName, courseFields, level });
  }, [state]);

  useEffect(() => {
    if (state.status === "error" && state.offline) {
      void readProgressSnapshot().then((snapshot) => setFromPhone({ courseFields: snapshot?.courseFields ?? [], onboarded: (snapshot?.courseFields?.length ?? 0) > 0 }));
    }
  }, [state]);

  if (state.status === "ready") return <Body catalogue={catalogue} initial={state.data.courseFields} onboarded={state.data.onboarded} offline={false} />;
  if (state.status === "error" && state.offline && fromPhone) return <Body catalogue={catalogue} initial={fromPhone.courseFields} onboarded={fromPhone.onboarded} offline retry={reload} />;
  return (
    <section>
      <UniversitiesTitle />
      <MeStatus state={state} reload={reload} />
    </section>
  );
}

function UniversitiesTitle() {
  const t = useTranslations("student.universities");
  return <h1>{t("title")}</h1>;
}

function Body({ catalogue, initial, onboarded, offline, retry }: { catalogue: readonly CatalogueEntry[]; initial: string[]; onboarded: boolean; offline: boolean; retry?: () => void }) {
  const t = useTranslations("student.universities");
  const me = useTranslations("me");
  const courses = useTranslations("courses");
  const { labels, courseNames } = useUniversityLabels();
  const [selected, setSelected] = useState<string[]>(initial);
  const ordered = useMemo(() => orderUniversities(catalogue, selected), [catalogue, selected]);
  // Only the fields some university offers are worth a button.
  const offered = useMemo(() => COURSE_FIELDS.filter((field) => catalogue.some((university) => university.fields.includes(field))), [catalogue]);

  const toggle = (field: string) => setSelected((current) => (current.includes(field) ? current.filter((f) => f !== field) : [...current, field]));

  return (
    <section>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      {offline ? (
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
      {onboarded ? null : (
        <p className="me-notice" data-testid="finish-profile">
          {t("finishProfile")}{" "}
          <a className="me-button me-button-quiet" href="/me/onboarding">
            {t("finishButton")}
          </a>
        </p>
      )}
      {offered.length > 0 ? (
        <fieldset className="course-chips">
          <legend>{t("yourCourses")}</legend>
          {offered.map((field) => (
            <button key={field} type="button" className="course-chip" aria-pressed={selected.includes(field)} onClick={() => toggle(field)}>
              {courses(field)}
            </button>
          ))}
          <p className="me-muted">{selected.length > 0 ? t("chooseHint") : t("noCourse")}</p>
        </fieldset>
      ) : null}
      {ordered.length === 0 ? <p>{t("empty")}</p> : <UniversityList items={ordered} courseNames={courseNames} labels={labels} />}
    </section>
  );
}
