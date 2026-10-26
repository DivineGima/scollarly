"use client";

import { useEffect, useState } from "react";
import type { ProgressSnapshot } from "@/offline/db";
import { readProgressSnapshot } from "@/offline/progress-snapshot";
import { OfflineCard, type OfflineCardLabels } from "./offline-card";

/**
 * The service worker serves `/offline` when `/me` cannot be fetched (`/me` is never cached, architecture 11.1). If this phone kept a
 * stage the last time the student was online, it is shown here with its date; if not, the page shows only its usual text. It reads
 * the one local record and makes no request. Its words come from the server-rendered page, so it needs no translation runtime.
 */
export function OfflineProgress({ labels, stageNames }: { labels: OfflineCardLabels; stageNames: Record<string, string> }) {
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null);
  useEffect(() => {
    void readProgressSnapshot().then(setSnapshot);
  }, []);
  return snapshot ? <OfflineCard snapshot={snapshot} labels={labels} stageName={stageNames[snapshot.stageCode] ?? snapshot.stageCode} embedded /> : null;
}
