import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CourseFinder, type CourseFinderLabels } from "@/components/public/course-finder";
import { COURSE_FIELDS } from "@/lib/courses";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { MediaImage } from "@/components/public/media-image";
import { Paragraphs } from "@/components/public/copy";
import { PageLink } from "@/components/public/page-link";
import { FaqList } from "@/components/public/steps";
import { Testimonials, TrustStats } from "@/components/public/trust";
import { UniversityCard } from "@/components/public/university-card";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { toCourseCatalogue } from "@/modules/content/course-catalogue";
import { readCatalogue, readPageImages, readSite, readTrust } from "@/modules/content/read";
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
  const [t, courses, tWhatsApp, snapshot, site, trust, pageImages] = await Promise.all([getTranslations("home"), getTranslations("courses"), getTranslations("site.whatsapp"), readCatalogue(), readSite(), readTrust(), readPageImages()]);
  const { universities } = snapshot;
  const { blocks } = site;
  const steps = site.processSteps.filter((s) => s.kind === "application");
  const featured = universities.slice(0, 6);
  const heroPhoto = pageImages["home.hero"];
  // The course finder (F13): the public catalogue is the same for everyone, so it is safe in this cached page. It lists every course on the
  // owner's list; one no university offers yet answers with a message and WhatsApp (FR-31). With no university at all, the finder is left out.
  const catalogue = toCourseCatalogue(snapshot);
  const showFinder = catalogue.length > 0;
  const whatsappHref = buildWhatsAppUrl(site.contact.whatsappE164) ?? "/contact";
  const finderLabels = Object.fromEntries(
    (["heading", "label", "choose", "prompt", "countOne", "countOther", "none", "cta", "ctaHint", "naac", "naacMissing", "open"] as const).map((key) => [key, t(`finder.${key}`)]),
  ) as unknown as CourseFinderLabels;
  finderLabels.whatsapp = tWhatsApp("chat");
  const courseNames = Object.fromEntries(COURSE_FIELDS.map((field) => [field, courses(field)]));
  const logoUniversities = universities.filter((university) => university.logo);

  return (
    <>
      <section className={heroPhoto ? "hero hero-with-media" : "hero"} aria-labelledby="hero-title">
        <div>
          <h1 id="hero-title">{blocks["hero.title"] ?? t("hero.title")}</h1>
          <p className="lead">{blocks["hero.subtitle"] ?? t("hero.subtitle")}</p>
          <p className="cta-row">
            <PageLink href="/apply" className="btn btn-primary">
              {t("startApplication")}
            </PageLink>
            <WhatsAppButton context={{ page: "/" }} />
          </p>
          <p className="muted">{t("freeForStudents")}</p>
        </div>
        {heroPhoto ? (
          <div className="hero-media">
            <MediaImage media={heroPhoto} eager priority className="hero-photo" />
          </div>
        ) : null}
      </section>

      {showFinder ? <CourseFinder catalogue={catalogue} fields={COURSE_FIELDS} courseNames={courseNames} labels={finderLabels} whatsappHref={whatsappHref} /> : null}

      {logoUniversities.length > 0 ? (
        <section aria-labelledby="logos-heading" className="section">
          <h2 id="logos-heading">{t("logosHeading")}</h2>
          <ul className="logo-strip">
            {logoUniversities.map((university) => (
              <li key={university.id}>
                <PageLink href={`/universities/${university.slug}`}>
                  <MediaImage media={{ ...university.logo!, alt: university.logo!.alt || university.name }} className="logo" />
                </PageLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
