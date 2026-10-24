import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Paragraphs } from "@/components/public/copy";
import { PageLink } from "@/components/public/page-link";
import { FaqList } from "@/components/public/steps";
import { Testimonials, TrustStats } from "@/components/public/trust";
import { UniversityCard } from "@/components/public/university-card";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { readCatalogue, readSite, readTrust } from "@/modules/content/read";
import { pageMetadata } from "@/components/public/page-metadata";

// A1. Prerendered; the content is read at build or revalidate time and a publish refreshes it (architecture 6.1, 10.4).
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "home");
}

const SERVICES = ["consultation", "admissions", "scholarships", "visa", "support"] as const;
const WHY = ["free", "real", "support", "risk"] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { universities }, site, trust] = await Promise.all([getTranslations("home"), readCatalogue(), readSite(), readTrust()]);
  const { blocks } = site;
  const steps = site.processSteps.filter((s) => s.kind === "application");
  const featured = universities.slice(0, 6);

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">{blocks["hero.title"] ?? t("hero.title")}</h1>
        <p className="lead">{blocks["hero.subtitle"] ?? t("hero.subtitle")}</p>
        <p className="cta-row">
          <PageLink href="/apply" className="btn btn-primary">
            {t("startApplication")}
          </PageLink>
          <WhatsAppButton context={{ page: "/" }} />
        </p>
        <p className="muted">{t("freeForStudents")}</p>
      </section>

      <TrustStats stats={trust.stats} />

      <section aria-labelledby="universities-heading" className="section">
        <h2 id="universities-heading">{t("universitiesHeading")}</h2>
        {featured.length > 0 ? (
          <>
            <ul className="grid cards">
              {featured.map((university) => (
                <UniversityCard key={university.id} university={university} />
              ))}
            </ul>
            <p>
              <PageLink href="/universities">{t("allUniversities")}</PageLink>
            </p>
          </>
        ) : (
          <p>{t("universitiesEmpty")}</p>
        )}
      </section>

      {steps.length > 0 ? (
        <section aria-labelledby="process-heading" className="section">
          <h2 id="process-heading">{t("processHeading")}</h2>
          <ol className="steps compact">
            {steps.map((step) => (
              <li key={step.id}>
                <PageLink href={`/process#step-${step.position}`}>
                  <span className="step-number" aria-hidden="true">
                    {step.position}
                  </span>
                  {step.title}
                </PageLink>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {WHY.some((key) => blocks[`why.${key}.title`]) ? (
        <section aria-labelledby="why-heading" className="section">
          <h2 id="why-heading">{t("whyHeading")}</h2>
          <ul className="grid cards">
            {WHY.filter((key) => blocks[`why.${key}.title`]).map((key) => (
              <li key={key} className="card">
                <h3>{blocks[`why.${key}.title`]}</h3>
                <Paragraphs text={blocks[`why.${key}.body`] ?? ""} />
              </li>
            ))}
          </ul>
          {blocks["why.summary"] ? <Paragraphs text={blocks["why.summary"]} className="muted" /> : null}
        </section>
      ) : null}

      {SERVICES.some((key) => blocks[`services.${key}.title`]) ? (
        <section aria-labelledby="services-heading" className="section">
          <h2 id="services-heading">{t("servicesHeading")}</h2>
          <ul className="grid cards">
            {SERVICES.filter((key) => blocks[`services.${key}.title`]).map((key) => (
              <li key={key} className="card">
                <h3>{blocks[`services.${key}.title`]}</h3>
                <Paragraphs text={blocks[`services.${key}.body`] ?? ""} />
              </li>
            ))}
          </ul>
          {blocks["services.free_notice"] ? <Paragraphs text={blocks["services.free_notice"]} className="muted" /> : null}
        </section>
      ) : null}

      <Testimonials items={trust.testimonials} />

      {site.faqs.length > 0 ? (
        <section aria-labelledby="faq-heading" className="section">
          <h2 id="faq-heading">{t("faqHeading")}</h2>
          <FaqList faqs={site.faqs.slice(0, 4)} generalLabel={t("faqGeneral")} />
          <p>
            <PageLink href="/faq">{t("allFaq")}</PageLink>
          </p>
        </section>
      ) : null}
    </>
  );
}
