import { PIPELINE_STAGE_CODES } from "@/lib/constants";
import type { ProcessStepView } from "./types";

/**
 * The seven steps of an application as the public pages show them (architecture 24.11, PRD_5 FR-52). The words are translation keys, not content
 * rows: they are the same seven steps the student sees in Progress and the staff see in the pipeline, so they must not drift from `PIPELINE_STAGE_CODES`.
 * The visa page keeps its own content steps (those are the visa paperwork, not the application steps).
 */

type Say = (key: string) => string;

/** The application steps in order, numbered from 1. `t` is the `process` namespace. */
export function sevenSteps(t: Say): ProcessStepView[] {
  return PIPELINE_STAGE_CODES.map((code, index) => ({
    id: code,
    kind: "application" as const,
    position: index + 1,
    title: t(`seven.${code}.title`),
    body: t(`seven.${code}.body`),
  }));
}
