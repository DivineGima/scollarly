import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MediaImage } from "@/components/public/media-image";
import { pageMetadata } from "@/components/public/page-metadata";
import { CampusSection } from "@/components/public/university-parts";
import { readCatalogue, readPageImages } from "@/modules/content/read";

// A4 /campus-tours (PRD_3 F22). Every video and tour is a facade (FR-3). Only a university with a real video or tour is listed here: there is
// no "available on request" and no WhatsApp fallback, because this page is a tour and nothing else. The other universities stay on /universities.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "tours");
}

export default async function CampusToursPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { universities }, pageImages] = await Promise.all([getTranslations("tours"), readCatalogue(), readPageImages()]);
  const photo = pageImages["tours.photo"];
  const withTours = universities.filter((university) => university.experiences.length > 0);

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      {photo ? <MediaImage media={photo} className="page-photo" /> : null}
      {withTours.length === 0 ? <p>{t("empty")}</p> : null}
      {withTours.map((university) => (
        <section key={university.id} aria-labelledby={`tour-${university.slug}`} className="section">
          <h2 id={`tour-${university.slug}`}>{university.name}</h2>
          <CampusSection experiences={university.experiences} withHeading={false} headingId={`tour-${university.slug}`} />
        </section>
      ))}
    </>
  );
}
