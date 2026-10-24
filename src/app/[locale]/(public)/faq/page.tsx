import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/components/public/page-metadata";
import { FaqList } from "@/components/public/steps";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { readSite } from "@/modules/content/read";

// A4 /faq: tap a question and the answer opens. Every answer is in the HTML.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "faq");
}

export default async function FaqPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { faqs }] = await Promise.all([getTranslations("faq"), readSite()]);

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      {faqs.length > 0 ? <FaqList faqs={faqs} generalLabel={t("general")} /> : <p>{t("empty")}</p>}
      <p className="cta-row">
        <WhatsAppButton context={{ page: "/faq" }} />
      </p>
    </>
  );
}
