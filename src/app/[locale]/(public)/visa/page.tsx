import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Paragraphs } from "@/components/public/copy";
import { pageMetadata } from "@/components/public/page-metadata";
import { StepList } from "@/components/public/steps";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { readSite } from "@/modules/content/read";

// A4 /visa: the visa steps.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "visa");
}

export default async function VisaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { processSteps, blocks }] = await Promise.all([getTranslations("visa"), readSite()]);
  const steps = processSteps.filter((s) => s.kind === "visa");

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      {steps.length > 0 ? <StepList steps={steps} idPrefix="visa" /> : <p>{t("empty")}</p>}
      {blocks["visa.note"] ? (
        <aside className="notice" aria-label={t("noteLabel")}>
          <Paragraphs text={blocks["visa.note"]} />
        </aside>
      ) : null}
      <p className="cta-row">
        <WhatsAppButton context={{ page: "/visa" }} />
      </p>
    </>
  );
}
