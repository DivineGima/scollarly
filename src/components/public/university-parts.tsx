import { getTranslations } from "next-intl/server";
import { formatRange } from "@/modules/content/fees";
import { watDateString } from "@/lib/time";
import type { CampusView, FeeLine, UniversityView } from "@/modules/content/types";
import { CampusEmbed } from "./campus-embed";
import { WhatsAppButton } from "./whatsapp-button";

/**
 * The fee section of a university page (FR-2, architecture 16 A3 step 2). Confirmed lines show a range with its currency,
 * period and "last updated" date, plus the disclaimer. When nothing is confirmed the section says "Fees to be confirmed"
 * and offers WhatsApp. It never shows 0 or an empty cell.
 */
export async function FeeSection({ university, page }: { university: Pick<UniversityView, "id" | "name" | "fees">; page: string }) {
  const t = await getTranslations("university");
  return (
    <section aria-labelledby="fees-heading" className="section">
      <h2 id="fees-heading">{t("feesHeading")}</h2>
      {university.fees.length > 0 ? (
        <>
          <ul className="fee-lines">
            {university.fees.map((line) => (
              <li key={line.id}>
                <strong>{formatRange(line)}</strong> <span className="muted">{line.period}</span>
                <span className="muted block">{t("feeUpdated", { date: feeDate(line) })}</span>
              </li>
            ))}
          </ul>
          <p className="muted">{t("feeDisclaimer")}</p>
        </>
      ) : (
        <>
          <p>{t("feesTbc")}</p>
          <WhatsAppButton context={{ page, universityId: university.id, universityName: university.name }} labelKey="ask" />
        </>
      )}
    </section>
  );
}

export function feeDate(line: Pick<FeeLine, "lastUpdatedAt">): string {
  return watDateString(new Date(line.lastUpdatedAt));
}

/** Campus videos and tours for a university (FR-3). Every item is a facade: nothing loads until a tap. */
export async function CampusSection({ experiences, headingId = "campus-heading", withHeading = true }: { experiences: CampusView[]; headingId?: string; withHeading?: boolean }) {
  const t = await getTranslations("university");
  if (experiences.length === 0) return null;
  const labels = {
    play: t("embed.play"),
    openTour: t("embed.openTour"),
    needsConnection: t("embed.needsConnection"),
    dataNotice: t("embed.dataNotice"),
    dataNoticeConfirm: t("embed.dataNoticeConfirm"),
    viewGallery: t("embed.viewGallery"),
    noThumbnail: t("embed.noThumbnail"),
  };
  return (
    <section aria-labelledby={headingId} className="section">
      {withHeading ? <h2 id={headingId}>{t("campusHeading")}</h2> : null}
      <div className="embeds">
        {experiences.map((item) => (
          <CampusEmbed
            key={item.id}
            kind={item.kind}
            title={item.title}
            youtubeId={item.youtubeId}
            url={item.url}
            thumbnail={item.thumbnail ? { src: `/media/${item.thumbnail.sha256}.webp`, width: item.thumbnail.width, height: item.thumbnail.height, alt: item.thumbnail.alt } : null}
            labels={labels}
          />
        ))}
      </div>
    </section>
  );
}
