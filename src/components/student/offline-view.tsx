"use client";

import { useTranslations } from "next-intl";
import type { ProgressSnapshot } from "@/offline/db";
import { OfflineCard } from "./offline-card";

/** `/me` with no connection: the card, in the student's language. */
export function Offline({ snapshot, retry }: { snapshot: ProgressSnapshot; retry?: () => void }) {
  const t = useTranslations("me.progress");
  const stages = useTranslations("me.stages");
  return (
    <OfflineCard
      snapshot={snapshot}
      stageName={stages.has(snapshot.stageCode) ? stages(snapshot.stageCode) : snapshot.stageCode}
      labels={{ title: t("title"), body: t("offline.body"), reference: t("reference"), stage: t("offline.stage"), lastUpdated: t.raw("lastUpdated") as string, retry: t("offline.retry") }}
      {...(retry ? { retry } : {})}
    />
  );
}
