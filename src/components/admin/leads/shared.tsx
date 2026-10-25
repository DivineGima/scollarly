"use client";

import { useTranslations } from "next-intl";
import { formatWat } from "@/lib/time";
import { Badge } from "../ui/badge";

/** What the lead data calls send (architecture 8.4). Declared here, not imported from the server code, so the browser bundle stays free of it. */

export interface Sla {
  status: "met" | "open" | "overdue";
  dueAt: string;
}

export interface StageOption {
  code: string;
  name: Record<string, string> | string;
}

export interface Person {
  id: string;
  label: string;
}

export interface LeadListItem {
  id: string;
  ref: string;
  name: string | null;
  country: string;
  stage: string;
  assigned: Person | null;
  sla: Sla;
  receivedAt: string;
  erased: boolean;
  quick: boolean;
}

export interface PairSide {
  id: string;
  ref: string;
  name: string;
  receivedAt: string;
  stageCode: string;
}

export interface DuplicatePairData {
  a: PairSide;
  b: PairSide;
}

/** The pipeline stage's English name (the admin screens are English in v1). */
export function stageName(stages: readonly StageOption[], code: string): string {
  const stage = stages.find((s) => s.code === code);
  if (!stage) return code;
  return typeof stage.name === "string" ? stage.name : (stage.name.en ?? code);
}

/** B2 column "SLA badge": the due time in WAT, Met, or Overdue in red. Read from the stored target, never recalculated (FR-12). */
export function SlaBadge({ sla }: { sla: Sla }) {
  const t = useTranslations("admin.leads.sla");
  if (sla.status === "met") return <Badge variant="success">{t("met")}</Badge>;
  if (sla.status === "overdue") return <Badge variant="danger">{t("overdue", { time: formatWat(new Date(sla.dueAt)) })}</Badge>;
  return <Badge>{t("due", { time: formatWat(new Date(sla.dueAt)) })}</Badge>;
}

/** The error a mutation's answer should show, from its `code` and `fields` (the server sends tokens, never sentences, FR-15). */
export function failureKey(result: { status: number; code: string; fields: Record<string, string> }): string {
  if (result.status === 0) return "network";
  if (result.code === "CONFLICT" && result.fields.version === "STALE") return "stale";
  if (result.code === "CONFLICT" && result.fields.lead === "UNAVAILABLE") return "unavailable";
  if (result.code === "NOT_FOUND") return "notFound";
  if (result.status === 401 || result.status === 403) return "forbidden";
  return "generic";
}
