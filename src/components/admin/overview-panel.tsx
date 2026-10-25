"use client";


import { useTranslations } from "next-intl";
import { useAdminSession } from "./admin-shell";
import { stageName, type StageOption } from "./leads/shared";
import { DataStatus, useAdminData } from "./use-admin-data";

interface OverviewData {
  unanswered: number;
  overdue: number;
  mine: number;
  unassigned: number;
  today: number;
  pendingClaims: number;
  openDataRequests: number;
  funnel: { code: string; name: StageOption["name"]; count: number }[];
}

interface Tile {
  key: "unanswered" | "overdue" | "mine" | "unassigned" | "pendingClaims" | "openDataRequests" | "today";
  href: string;
}

/** B1 step 1 and 2: each tile opens the matching filtered list. */
const TILES: readonly Tile[] = [
  { key: "unanswered", href: "/admin/leads?view=unanswered" },
  { key: "overdue", href: "/admin/leads?view=overdue" },
  { key: "mine", href: "/admin/leads?assigned=me" },
  { key: "unassigned", href: "/admin/leads?view=unassigned" },
  { key: "pendingClaims", href: "/admin/leads/link-requests" },
  { key: "openDataRequests", href: "/admin/data-requests" },
  { key: "today", href: "/admin/leads" },
];

/** B1: the counts (one SQL statement in the database, S5.3) and a mini funnel. */
export function OverviewPanel() {
  const t = useTranslations("admin.overview");
  const session = useAdminSession();
  const { state, reload } = useAdminData<OverviewData>("/api/v1/admin/overview");

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-4">{t("welcome", { name: session.name || session.email })}</p>

      <div className="mt-6">
        <DataStatus state={state} reload={reload} />
      </div>

      {state.status === "ready" ? (
        <>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TILES.map((tile) => {
              const value = state.data[tile.key];
              return (
                <li key={tile.key}>
                  <a href={tile.href} className="block min-h-11 rounded-lg border border-border p-4 hover:bg-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <span className="block text-3xl font-semibold" data-testid={`tile-${tile.key}`}>
                      {value}
                    </span>
                    <span className="mt-1 block text-fg-muted">{t(`tiles.${tile.key}`)}</span>
                  </a>
                </li>
              );
            })}
          </ul>

          <h2 className="mt-8 text-xl font-semibold">{t("funnelTitle")}</h2>
          {state.data.funnel.every((f) => f.count === 0) ? (
            <p className="mt-2 text-fg-muted">{t("funnelEmpty")}</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {state.data.funnel.map((stage) => {
                const max = Math.max(...state.data.funnel.map((f) => f.count), 1);
                return (
                  <li key={stage.code}>
                    <a href={`/admin/leads?stage=${stage.code}`} className="block rounded-md p-2 hover:bg-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      <span className="flex justify-between gap-4">
                        <span>{stageName([stage], stage.code)}</span>
                        <span className="font-semibold">{stage.count}</span>
                      </span>
                      <span className="mt-1 block h-2 rounded-full bg-surface" aria-hidden="true">
                        <span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.round((stage.count / max) * 100)}%` }} />
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : null}
    </section>
  );
}
