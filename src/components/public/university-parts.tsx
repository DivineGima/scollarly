import { getTranslations } from "next-intl/server";
import type { CampusView } from "@/modules/content/types";
import { CampusEmbed } from "./campus-embed";
import { WhatsAppButton } from "./whatsapp-button";

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
