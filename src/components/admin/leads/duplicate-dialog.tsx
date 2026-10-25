"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FieldError } from "../ui/input";
import { type DuplicatePairData, type PairSide, type StageOption, stageName } from "./shared";

/**
 * B3 step 10: the two leads side by side, with "Merge into this one" for each and "Not a duplicate". Nothing is merged
 * unless a person taps (architecture 7.2). The server decides whether the pair is still a pair, so a stale screen gets an
 * answer, not a wrong merge.
 */
export function DuplicateDialog({
  pair,
  stages,
  onClose,
  onResolved,
}: {
  pair: DuplicatePairData | null;
  stages: readonly StageOption[];
  onClose: () => void;
  onResolved: () => void;
}) {
  const t = useTranslations("admin.leads.duplicates");
  const common = useTranslations("admin.common");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(keep: PairSide, other: PairSide, decision: "merged" | "not_duplicate") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await api("POST", "/api/v1/admin/leads.resolveDuplicate", { keepId: keep.id, otherId: other.id, decision });
    setBusy(false);
    if (result.ok) {
      onResolved();
      return;
    }
    if (result.status === 401) window.location.replace("/sign-in");
    setError(result.status === 0 ? "network" : result.code === "CONFLICT" ? "stale" : "generic");
  }

  const side = (lead: PairSide) => (
    <div className="rounded-md border border-border p-3">
      <p className="font-semibold">{lead.ref}</p>
      <p>{lead.name}</p>
      <p className="text-sm text-fg-muted">{formatWat(new Date(lead.receivedAt))}</p>
      <p className="text-sm text-fg-muted">{stageName(stages, lead.stageCode)}</p>
    </div>
  );

  return (
    <Dialog open={pair !== null} onClose={onClose} title={t("compareTitle")} className="w-[min(40rem,calc(100vw-2rem))]">
      {pair ? (
        <>
          <p className="text-fg-muted">{t("sameNumber")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {side(pair.a)}
            {side(pair.b)}
          </div>
          {error ? <FieldError>{t(`errors.${error}`)}</FieldError> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void resolve(pair.a, pair.b, "merged")}>
              {t("mergeInto", { ref: pair.a.ref })}
            </Button>
            <Button disabled={busy} onClick={() => void resolve(pair.b, pair.a, "merged")}>
              {t("mergeInto", { ref: pair.b.ref })}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void resolve(pair.a, pair.b, "not_duplicate")}>
              {t("notDuplicate")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {common("cancel")}
            </Button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
