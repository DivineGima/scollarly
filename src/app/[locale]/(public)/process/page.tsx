import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/components/public/page-metadata";
import { PageLink } from "@/components/public/page-link";
import { StepList } from "@/components/public/steps";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { readSite } from "@/modules/content/read";

// A4 /process: the application steps in order, each with what Scollarly does.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "process");
}

export default async function ProcessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { processSteps }] = await Promise.all([getTranslations("process"), readSite()]);
  const steps = processSteps.filter((s) => s.kind === "application");

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      {steps.length > 0 ? <StepList steps={steps} idPrefix="step" /> : <p>{t("empty")}</p>}
      <p className="cta-row">
        <PageLink href="/apply" className="btn btn-primary">
          {t("apply")}
        </PageLink>
        <WhatsAppButton context={{ page: "/process" }} />
      </p>
    </>
  );
}
