import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Paragraphs } from "@/components/public/copy";
import { MediaImage } from "@/components/public/media-image";
import { PageLink } from "@/components/public/page-link";
import { CampusSection, FeeSection } from "@/components/public/university-parts";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { readCatalogue } from "@/modules/content/read";

// A3. A university published after the last build is rendered on first request and then cached like the others.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const { universities } = await readCatalogue();
  return universities.map((university) => ({ slug: university.slug }));
}

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const university = (await readCatalogue()).universities.find((u) => u.slug === slug);
  if (!university) return {};
  return { title: university.name, description: university.overview.slice(0, 160) || undefined };
}

export default async function UniversityPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [t, { universities }] = await Promise.all([getTranslations("university"), readCatalogue()]);
  const university = universities.find((u) => u.slug === slug);
  if (!university) notFound();
  const page = `/universities/${university.slug}`;

  return (
    <>
      <p>
        <PageLink href="/universities">{t("back")}</PageLink>
      </p>
      <header className="uni-header">
        {university.logo ? (
          <MediaImage media={{ ...university.logo, alt: university.logo.alt || university.name }} className="logo logo-large" eager />
        ) : null}
        <div>
          <h1>{university.name}</h1>
          <p className="muted">{[university.city, university.state].filter(Boolean).join(", ")}</p>
          <p className="badges">
            {university.type ? <span className="badge">{university.type}</span> : null}
            {university.naacGrade ? <span className="badge">{t("naac", { grade: university.naacGrade })}</span> : null}
          </p>
        </div>
      </header>

      {university.overview ? (
        <section aria-labelledby="overview-heading" className="section">
          <h2 id="overview-heading">{t("overviewHeading")}</h2>
          <Paragraphs text={university.overview} />
        </section>
      ) : null}

      {university.programmes.length > 0 ? (
        <section aria-labelledby="programmes-heading" className="section">
          <h2 id="programmes-heading">{t("programmesHeading")}</h2>
          <ul className="programmes">
            {university.programmes.map((programme) => (
              <li key={programme.id}>
                <span>{programme.name}</span>
                {programme.durationMonths ? <span className="muted">{t("duration", { months: programme.durationMonths })}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FeeSection university={university} page={page} />
      <CampusSection experiences={university.experiences} />

      {university.resources.length > 0 || university.websiteUrl ? (
        <section aria-labelledby="resources-heading" className="section">
          <h2 id="resources-heading">{t("resourcesHeading")}</h2>
          <ul className="plain">
            {university.resources.map((resource) => (
              <li key={resource.id}>
                <a href={resource.url} target="_blank" rel="noopener noreferrer">
                  {resource.title}
                  <span className="sr-only"> {t("opensNewTab")}</span>
                </a>
              </li>
            ))}
            {university.websiteUrl ? (
              <li>
                <a href={university.websiteUrl} target="_blank" rel="noopener noreferrer">
                  {t("officialWebsite")}
                  <span className="sr-only"> {t("opensNewTab")}</span>
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section className="section cta-band" aria-labelledby="next-heading">
        <h2 id="next-heading">{t("nextHeading")}</h2>
        <p className="cta-row">
          <PageLink href="/apply" className="btn btn-primary">
            {t("apply")}
          </PageLink>
          <WhatsAppButton context={{ page, universityId: university.id, universityName: university.name }} labelKey="ask" />
        </p>
      </section>
    </>
  );
}
