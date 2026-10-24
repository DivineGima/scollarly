import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ApplyForm } from "@/components/public/lead/apply-form";
import { getLeadLabels } from "@/components/public/lead/get-labels";
import { pageMetadata } from "@/components/public/page-metadata";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile-site-key";
import { readCatalogue, readSite } from "@/modules/content/read";

// A5 Start your application. The page and the programme list are prerendered; the form is a client island that works offline.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "apply.page");
}

/** A full lead needs three different programmes (ADR-030), so the form is offered only when there are at least that many. */
const MIN_PROGRAMMES = 3;

export default async function ApplyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, labels, { universities }, { contact }] = await Promise.all([getTranslations("apply"), getLeadLabels(locale), readCatalogue(), readSite()]);
  const programmes = universities.flatMap((u) => u.programmes.map((p) => ({ id: p.id, name: p.name, universityId: u.id, universityName: u.name })));

  return (
    <>
      <h1>{labels.applyTitle}</h1>
      <p className="lead">{labels.applyIntro}</p>
      {programmes.length >= MIN_PROGRAMMES ? (
        <>
          <noscript>
            <p className="notice">{t("apply.noscript")}</p>
          </noscript>
          <ApplyForm labels={labels} programmes={programmes} numberE164={contact.whatsappE164} siteKey={TURNSTILE_SITE_KEY} locale={locale} />
        </>
      ) : (
        <>
          <p className="notice">{t("apply.soon")}</p>
          <WhatsAppButton context={{ page: "/apply" }} />
        </>
      )}
    </>
  );
}
