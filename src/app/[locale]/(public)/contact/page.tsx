import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CopyButton } from "@/components/public/copy-button";
import { Paragraphs } from "@/components/public/copy";
import { PageLink } from "@/components/public/page-link";
import { pageMetadata } from "@/components/public/page-metadata";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { telHref } from "@/lib/phone";
import { readSite } from "@/modules/content/read";

// A6 + S4.6. Every number comes from `site_setting` (FR-4); when the owner has not set one the page says so.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "contact");
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { contact, blocks }] = await Promise.all([getTranslations("contact"), readSite()]);
  const tel = telHref(contact.phoneDisplay);

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>

      <section aria-labelledby="whatsapp-heading" className="section">
        <h2 id="whatsapp-heading">{t("whatsappHeading")}</h2>
        {contact.whatsappE164 ? (
          <>
            <p>
              <strong>{contact.whatsappE164}</strong>
            </p>
            <p className="cta-row">
              <WhatsAppButton context={{ page: "/contact" }} />
              <CopyButton value={contact.whatsappE164} label={t("copyNumber")} copied={t("copied")} />
            </p>
          </>
        ) : (
          <p>{t("whatsappPending")}</p>
        )}
      </section>

      <section aria-labelledby="other-heading" className="section">
        <h2 id="other-heading">{t("otherHeading")}</h2>
        <ul className="plain">
          {contact.phoneDisplay && tel ? (
            <li>
              {t("phone")}: <a href={tel}>{contact.phoneDisplay}</a>
            </li>
          ) : null}
          {blocks["contact.email"] ? (
            <li>
              {t("email")}: <a href={`mailto:${blocks["contact.email"]}`}>{blocks["contact.email"]}</a>
            </li>
          ) : null}
        </ul>
        {blocks["contact.office"] ? <Paragraphs text={blocks["contact.office"]} /> : null}
        {!contact.phoneDisplay && !blocks["contact.email"] ? <p>{t("otherPending")}</p> : null}
      </section>

      <p className="cta-row">
        <PageLink href="/apply" className="btn btn-primary">
          {t("apply")}
        </PageLink>
      </p>
    </>
  );
}
