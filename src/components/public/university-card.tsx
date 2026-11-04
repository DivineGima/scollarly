import { getTranslations } from "next-intl/server";
import type { UniversityView } from "@/modules/content/types";
import type { UniversityCardItem } from "./university-browser";
import { MediaImage } from "./media-image";

type Translate = Awaited<ReturnType<typeof getTranslations>>;

/** The plain data a client island needs for one card. */
export function toCardItem(university: UniversityView, t: Translate): UniversityCardItem {
  return {
    slug: university.slug,
    name: university.name,
    city: university.city,
    state: university.state,
    type: university.type,
    naacGrade: university.naacGrade,
    logo: university.logo ? { src: `/media/${university.logo.sha256}.webp`, width: university.logo.width, height: university.logo.height, alt: university.logo.alt || university.name } : null,
    levels: [...new Set(university.programmes.flatMap((p) => (p.level ? [p.level] : [])))],
  };
}

/** A card with no script, for the home page (the list page uses the filtering island). */
export async function UniversityCard({ university }: { university: UniversityView }) {
  const t = await getTranslations("universities");
  return (
    <li className="card">
      <a href={`/universities/${university.slug}`} className="card-link">
        <span className="card-head">
          {university.logo ? (
            <MediaImage media={{ ...university.logo, alt: university.logo.alt || university.name }} className="logo" />
          ) : (
            <span className="logo logo-placeholder" aria-hidden="true">
              {university.name.slice(0, 1)}
            </span>
          )}
          <span>
            <strong>{university.name}</strong>
            <span className="muted block">{[university.city, university.state].filter(Boolean).join(", ")}</span>
          </span>
        </span>
        <span className="badges">
          {university.type ? <span className="badge">{university.type}</span> : null}
          {university.naacGrade ? <span className="badge">{t("naac", { grade: university.naacGrade })}</span> : null}
        </span>
      </a>
    </li>
  );
}
