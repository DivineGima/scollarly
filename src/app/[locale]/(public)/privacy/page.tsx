import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Paragraphs } from "@/components/public/copy";
import { LegalSections, type LegalSection } from "@/components/public/legal-sections";
import { pageMetadata } from "@/components/public/page-metadata";
import { readSite } from "@/modules/content/read";

// A8. The text is a content block (`privacy.body`) so the owner can edit it after the legal review (PRD item Q6, tracker H5).
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "privacy");
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { blocks }] = await Promise.all([getTranslations("privacy"), readSite()]);
  return (
    <>
      <h1>{t("title")}</h1>
      {blocks["privacy.body"] ? (
        <Paragraphs text={blocks["privacy.body"]} />
      ) : (
        <LegalSections intro={t("intro")} updated={t("updated")} email={t("email")} sections={t.raw("sections") as LegalSection[]} />
      )}
    </>
  );
}
