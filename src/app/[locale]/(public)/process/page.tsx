import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/components/public/page-metadata";
import { StepList } from "@/components/public/steps";
import { CreateAccountLink } from "@/components/public/create-account-link";
import { sevenSteps } from "@/modules/content/seven-steps";

// A4 /process: the seven application steps in order, each with what Scollarly does, and what it costs (architecture 24.11, FR-52). The words are translation keys.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "process");
}

export default async function ProcessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("process");
  const steps = sevenSteps((key) => t(key as never));

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      <StepList steps={steps} idPrefix="step" />
      <section aria-labelledby="fees-heading" className="section">
        <h2 id="fees-heading">{t("fees.title")}</h2>
        <p>{t("fees.body")}</p>
      </section>
      <p className="cta-row">
        <CreateAccountLink next="/process" />
      </p>
    </>
  );
}
