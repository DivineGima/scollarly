import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/components/public/page-metadata";
import { CampusSection } from "@/components/public/university-parts";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { readCatalogue } from "@/modules/content/read";

// A4 /campus-tours. Every video and tour is a facade (FR-3). A university without one says "Available on request".
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "tours");
}

export default async function CampusToursPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { universities }] = await Promise.all([getTranslations("tours"), readCatalogue()]);

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      {universities.length === 0 ? <p>{t("empty")}</p> : null}
      {universities.map((university) => (
        <section key={university.id} aria-labelledby={`tour-${university.slug}`} className="section">
          <h2 id={`tour-${university.slug}`}>{university.name}</h2>
          {university.experiences.length > 0 ? (
            <CampusSection experiences={university.experiences} withHeading={false} headingId={`tour-${university.slug}`} />
          ) : (
            <>
              <p>{t("onRequest")}</p>
              <WhatsAppButton
                context={{ page: "/campus-tours", universityId: university.id, universityName: university.name }}
                variant="secondary"
                labelKey="ask"
              />
            </>
          )}
        </section>
      ))}
    </>
  );
}
