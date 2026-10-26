import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MediaImage } from "@/components/public/media-image";
import { pageMetadata } from "@/components/public/page-metadata";
import { UniversityBrowser } from "@/components/public/university-browser";
import { toCardItem } from "@/components/public/university-card";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { readCatalogue, readPageImages } from "@/modules/content/read";

// A2. The whole list is in the HTML; the island only narrows it in the browser.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "universities");
}

export default async function UniversitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { universities }, pageImages] = await Promise.all([getTranslations("universities"), readCatalogue(), readPageImages()]);
  const items = universities.map((university) => toCardItem(university, t));
  const photo = pageImages["universities.photo"];

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      {photo ? <MediaImage media={photo} className="page-photo" /> : null}
      {items.length > 0 ? (
        <UniversityBrowser
          items={items}
          labels={{
            search: t("search"),
            searchPlaceholder: t("searchPlaceholder"),
            filterLevel: t("filterLevel"),
            filterCity: t("filterCity"),
            all: t("all"),
            noMatch: t("noMatch"),
            results: t("results", { count: "{count}" }),
            naac: t("naac", { grade: "{grade}" }),
          }}
        />
      ) : (
        <>
          <p>{t("empty")}</p>
          <WhatsAppButton context={{ page: "/universities" }} />
        </>
      )}
    </>
  );
}
