"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every admin screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { CONTENT_TYPE_KEYS, type ContentTypeKey } from "@/modules/content-admin/definitions";
import { Badge } from "../ui/badge";
import { DataStatus, useAdminData } from "../use-admin-data";
import { formatBytes } from "./shared";

interface HubData {
  cards: { type: ContentTypeKey; draft: number; published: number; archived: number; warnings: number }[];
  media: { usedBytes: number; budgetBytes: number };
}

const LINK = "block min-h-11 rounded-lg border border-border p-4 hover:bg-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The share of the image budget at which the owner sees a banner (architecture 10.5). */
export const MEDIA_WARN_SHARE = 0.7;

/** B6: one card for each kind of content, with its counts and a warning when something needs a look. */
export function ContentHub() {
  const t = useTranslations("admin.content");
  const { state, reload } = useAdminData<HubData>("/api/v1/admin/content-hub");

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("hub.title")}</h1>
      <p className="mt-2 text-fg-muted">{t("hub.intro")}</p>
      <div className="mt-6">
        <DataStatus state={state} reload={reload} />
      </div>

      {state.status === "ready" ? <Cards data={state.data} /> : null}
    </section>
  );
}

function Cards({ data }: { data: HubData }) {
  const t = useTranslations("admin.content");
  const share = data.media.budgetBytes > 0 ? data.media.usedBytes / data.media.budgetBytes : 0;
  const stale = data.cards.filter((c) => c.type === "fees" || c.type === "campus" || c.type === "resources").reduce((sum, c) => sum + c.warnings, 0);
  const byType = new Map(data.cards.map((c) => [c.type, c]));

  return (
    <>
      {share >= MEDIA_WARN_SHARE ? (
        <p role="alert" className="mt-4 rounded-md border border-warning p-3 text-warning">
          {t("hub.mediaBanner", { percent: Math.round(share * 100) })}
        </p>
      ) : null}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONTENT_TYPE_KEYS.map((type) => {
          const card = byType.get(type);
          return (
            <li key={type}>
              <a href={`/admin/content/${type}`} className={LINK} data-testid={`card-${type}`}>
                <span className="flex items-start justify-between gap-2">
                  <span className="text-lg font-semibold">{t(`types.${type}.name`)}</span>
                  {card && card.warnings > 0 ? <Badge variant="warning">{t("hub.warnings", { count: card.warnings })}</Badge> : null}
                </span>
                <span className="mt-1 block text-fg-muted">{t(`types.${type}.about`)}</span>
                <span className="mt-2 block text-sm">
                  {t("hub.counts", { published: card?.published ?? 0, draft: card?.draft ?? 0, archived: card?.archived ?? 0 })}
                </span>
              </a>
            </li>
          );
        })}
        <li>
          <a href="/admin/content/media" className={LINK} data-testid="card-media">
            <span className="text-lg font-semibold">{t("hub.images")}</span>
            <span className="mt-1 block text-fg-muted">{t("hub.imagesAbout")}</span>
            <span className="mt-2 block text-sm">{t("hub.meter", { used: formatBytes(data.media.usedBytes), budget: formatBytes(data.media.budgetBytes) })}</span>
          </a>
        </li>
        <li>
          <a href="/admin/content/stale" className={LINK} data-testid="card-stale">
            <span className="flex items-start justify-between gap-2">
              <span className="text-lg font-semibold">{t("hub.stale")}</span>
              {stale > 0 ? <Badge variant="warning">{t("hub.warnings", { count: stale })}</Badge> : null}
            </span>
            <span className="mt-1 block text-fg-muted">{t("hub.staleAbout")}</span>
          </a>
        </li>
      </ul>
    </>
  );
}
