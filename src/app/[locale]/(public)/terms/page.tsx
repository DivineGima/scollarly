import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Paragraphs } from "@/components/public/copy";
import { pageMetadata } from "@/components/public/page-metadata";
import { readSite } from "@/modules/content/read";

// A8. The text is a content block (`terms.body`) so the owner can edit it after the legal review (PRD item Q6, tracker H5).
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "terms");
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { blocks }] = await Promise.all([getTranslations("terms"), readSite()]);
  return (
    <>
      <h1>{t("title")}</h1>
      {blocks["terms.body"] ? (
        <Paragraphs text={blocks["terms.body"]} />
      ) : (
        <>
          <p className="notice">{t("pending")}</p>
          <ul>
            <li>{t("summary.free")}</li>
            <li>{t("summary.accuracy")}</li>
            <li>{t("summary.contact")}</li>
          </ul>
        </>
      )}
    </>
  );
}
