"use client";

import { useEffect, useRef, useState } from "react";
import type { TabKey } from "@/modules/nav/config";

export interface TourStep {
  title: string;
  body: string;
}

export interface FirstVisitTourProps {
  tabKey: TabKey;
  /** One to three short steps. */
  steps: readonly TourStep[];
  labels: { next: string; skip: string; done: string; stepOf: (step: number, total: number) => string };
  /**
   * Whether this person has already seen the tour of this tab, from their user record (`app_user.tours_seen`). `null` while that is
   * not yet known: nothing is shown until it is, so the tour never flashes at someone who has seen it.
   */
  seen: boolean | null;
  /** Called once when the tour is finished or skipped. The screen sends it to the server (`app_mark_tour_seen`). */
  onSeen: (tab: TabKey) => void;
}

const storageKey = (tab: TabKey) => `tour-seen:${tab}`;

function readLocal(tab: TabKey): boolean {
  try {
    return window.localStorage.getItem(storageKey(tab)) === "1";
  } catch {
    return false;
  }
}

function writeLocal(tab: TabKey): void {
  try {
    window.localStorage.setItem(storageKey(tab), "1");
  } catch {
    // Storage can be blocked (private window, cleared site data); the server record is the one that counts.
  }
}

/**
 * The three-step tour a person sees the first time they open a tab (FR-21). Dismissible at any step, and it never repeats: finishing
 * or skipping records it on the user's record, and in local storage as a fallback for an offline moment.
 */
export function FirstVisitTour({ tabKey, steps, labels, seen, onSeen }: FirstVisitTourProps) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (readLocal(tabKey)) setDone(true);
  }, [tabKey]);

  const visible = seen === false && !done && steps.length > 0;
  useEffect(() => {
    if (visible) primary.current?.focus();
  }, [visible, index]);

  if (!visible) return null;
  const step = steps[Math.min(index, steps.length - 1)] as TourStep;
  const last = index >= steps.length - 1;

  const finish = () => {
    setDone(true);
    writeLocal(tabKey);
    onSeen(tabKey);
  };

  return (
    <div className="tour-backdrop" role="presentation">
      <div className="tour-card" role="dialog" aria-modal="true" aria-label={step.title}>
        <p className="tour-step">{labels.stepOf(index + 1, steps.length)}</p>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={finish}>
            {labels.skip}
          </button>
          <button ref={primary} type="button" className="tour-next" onClick={last ? finish : () => setIndex(index + 1)}>
            {last ? labels.done : labels.next}
          </button>
        </div>
      </div>
    </div>
  );
}
