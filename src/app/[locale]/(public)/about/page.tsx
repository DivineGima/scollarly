import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Paragraphs } from "@/components/public/copy";
import { pageMetadata } from "@/components/public/page-metadata";
import { Journeys, Team } from "@/components/public/trust";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { readSite, readTrust } from "@/modules/content/read";

// A4 /about: mission, values, and only confirmed team members (CLAUDE.md: no unconfirmed bios).
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "about");
}

const VALUES = ["commitment", "inclusivity", "honesty"] as const;

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { blocks }, trust] = await Promise.all([getTranslations("about"), readSite(), readTrust()]);
  const values = VALUES.filter((key) => blocks[`about.value.${key}.title`]);

  return (
    <>
      <h1>{t("title")}</h1>
      {blocks["about.summary"] ? <Paragraphs text={blocks["about.summary"]} className="lead" /> : <p className="lead">{t("fallback")}</p>}

      {blocks["about.mission"] ? (
        <section aria-labelledby="mission-heading" className="section">
          <h2 id="mission-heading">{t("missionHeading")}</h2>
          <Paragraphs text={blocks["about.mission"]} />
        </section>
      ) : null}

      {values.length > 0 ? (
        <section aria-labelledby="values-heading" className="section">
          <h2 id="values-heading">{t("valuesHeading")}</h2>
          <ul className="grid cards">
            {values.map((key) => (
              <li key={key} className="card">
                <h3>{blocks[`about.value.${key}.title`]}</h3>
                <Paragraphs text={blocks[`about.value.${key}.body`] ?? ""} />
              </li>
            ))}
          </ul>
          {blocks["about.motto"] ? <p className="motto">{blocks["about.motto"]}</p> : null}
        </section>
      ) : null}

      <Team members={trust.team} />
      <Journeys items={trust.journeys} />

      <p className="cta-row">
        <WhatsAppButton context={{ page: "/about" }} />
      </p>
    </>
  );
}
