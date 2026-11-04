"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- signed-in screens are cached shells plus a data call, so leaving one is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { PageIntro } from "@/components/shell/page-intro";
import { api } from "@/lib/client/api";
import { formatWat } from "@/lib/time";
import type { BoardCard } from "@/server/repositories/crm";
import { DataStatus, useAdminData } from "../use-admin-data";
import "../charts/charts.css";
import { CrmFilters, filterQuery, readAppliedFilters, type AppliedFilters } from "./crm-filters";

interface BoardData {
  columns: { code: string; label: string; total: number; cards: BoardCard[] }[];
}

type Moving = { id: string; state: "saving" } | { id: string; state: "error"; message: string };

/**
 * The pipeline board (PRD_3 F18 amended, ADR-058): every open lead in a column for its stage, newest first. A lead moves with a plain "Move to"
 * list (never drag and drop, so it works on a phone and with a keyboard), through the same audited stage change the lead page uses. A stale
 * lead (someone else changed it first) reloads the board with one plain sentence; nothing is lost silently. The date filter does not apply here:
 * a lead waiting at "visa" belongs on the board however old it is.
 */
export function PipelineBoard() {
  const t = useTranslations("admin.crm");
  const [applied, setApplied] = useState<AppliedFilters | null>(null);
  useEffect(() => setApplied(readAppliedFilters(window.location.search)), []);
  const query = applied ? filterQuery(applied, ["country", "source", "assigned"]) : null;
  const { state, reload } = useAdminData<BoardData>(query === null ? null : `/api/v1/admin/pipeline${query}`);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function move(card: BoardCard, stage: string) {
    setMoving({ id: card.id, state: "saving" });
    setNotice(null);
    const result = await api<{ changed?: boolean }>("POST", "/api/v1/admin/leads.changeStage", { leadId: card.id, stage, version: card.version });
    if (result.ok) {
      setMoving(null);
      reload();
      return;
    }
    if (result.status === 409) {
      // Someone else changed this lead first: show the board as it is now and say so.
      setMoving(null);
      setNotice(t("board.stale"));
      reload();
      return;
    }
    setMoving({ id: card.id, state: "error", message: result.status === 0 ? t("board.offline") : t("board.failed") });
  }

  return (
    <section className="crm" aria-labelledby="board-title">
      <PageIntro title={t("board.title")} purpose={t("board.purpose")} />
      {applied ? <CrmFilters view="pipeline" applied={applied} sources={[]} withDates={false} /> : null}
      {notice ? (
        <p role="status" className="admin-home-offline" data-testid="board-notice">
          {notice}
        </p>
      ) : null}
      {state.status !== "ready" ? <DataStatus state={state} reload={reload} /> : null}
      {state.status === "ready" ? (
        <div className="crm-board" data-testid="pipeline-board">
          {state.data.columns.map((column) => (
            <section key={column.code} className="crm-column" aria-labelledby={`col-${column.code}`} data-testid={`column-${column.code}`}>
              <h3 id={`col-${column.code}`}>
                {column.label} <span className="crm-badge">{column.total}</span>
              </h3>
              {column.cards.length === 0 ? (
                <p className="crm-explain">{t("board.emptyColumn")}</p>
              ) : (
                <ul className="crm-cards">
                  {column.cards.map((card) => (
                    <li key={card.id} className="crm-lead" data-testid="board-card">
                      <a href={`/admin/leads/${card.id}`}>
                        <strong>{card.ref}</strong>
                      </a>
                      <span>{card.name ?? t("board.noName")}</span>
                      <span className="crm-explain">
                        {card.country} · {formatWat(new Date(card.receivedAt))}
                      </span>
                      <span>
                        {card.overdue ? <span className="crm-badge crm-badge-warn">{t("board.overdue")}</span> : null}{" "}
                        {card.assigned ? null : <span className="crm-badge">{t("board.unassigned")}</span>}
                      </span>
                      <label>
                        <span className="sr-only">{t("board.moveLabel", { ref: card.ref })}</span>
                        <select
                          value={column.code}
                          disabled={moving?.id === card.id && moving.state === "saving"}
                          onChange={(event) => void move(card, event.target.value)}
                          aria-label={t("board.moveLabel", { ref: card.ref })}
                        >
                          {state.data.columns.map((target) => (
                            <option key={target.code} value={target.code}>
                              {target.code === column.code ? t("board.moveTo") : target.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {moving?.id === card.id && moving.state === "error" ? (
                        <span role="alert" className="crm-explain">
                          {moving.message}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {column.total > column.cards.length ? (
                <p className="crm-explain">
                  <a href="/admin/leads">{t("board.more", { count: column.total - column.cards.length })}</a>
                </p>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
