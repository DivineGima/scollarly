"use client";

import { useEffect, useMemo, useState } from "react";
import { orderUniversities, type CatalogueEntry } from "@/modules/student/ordering";
import type { ProgressSnapshot } from "@/offline/db";
import { hasStage, readProgressSnapshot } from "@/offline/progress-snapshot";
import { OfflineCard, type OfflineCardLabels } from "./offline-card";
import { UniversityList, type UniversityListLabels } from "./university-list";

export interface OfflineUniversities {
  catalogue: readonly CatalogueEntry[];
  courseNames: Readonly<Record<string, string>>;
  labels: UniversityListLabels;
  /** Contains `{name}`. */
  greeting: string;
  title: string;
}

/**
 * The service worker serves `/offline` when a page cannot be fetched. If this phone kept something the last time the student was online, it
 * is shown here: the last stage with its date, and (S13.4) the first name with the universities ordered for the courses they chose. It reads
 * the one local record and makes no request. Its words come from the server-rendered page, so it needs no translation runtime, and the
 * catalogue is the public one, so the page holds nothing personal.
 */
export function OfflineProgress({ labels, stageNames, universities }: { labels: OfflineCardLabels; stageNames: Record<string, string>; universities?: OfflineUniversities }) {
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null);
  useEffect(() => {
    void readProgressSnapshot().then(setSnapshot);
  }, []);
  const ordered = useMemo(() => (universities && snapshot ? orderUniversities(universities.catalogue, snapshot.courseFields ?? []) : []), [universities, snapshot]);
  if (!snapshot) return null;
  const showList = universities && ((snapshot.courseFields?.length ?? 0) > 0 || snapshot.firstName);
  return (
    <>
      {showList && snapshot.firstName ? <p data-testid="offline-greeting">{universities.greeting.replace("{name}", snapshot.firstName)}</p> : null}
      {hasStage(snapshot) ? <OfflineCard snapshot={snapshot} labels={labels} stageName={stageNames[snapshot.stageCode] ?? snapshot.stageCode} embedded /> : null}
      {showList ? (
        <section data-testid="offline-universities">
          <h2>{universities.title}</h2>
          <UniversityList items={ordered} courseNames={universities.courseNames} labels={universities.labels} />
        </section>
      ) : null}
    </>
  );
}
