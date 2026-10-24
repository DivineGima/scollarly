import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublishedTitle } from "@/modules/phase0/published";

// S0.6: static page whose content is cached under a tag. `POST /api/v1/probe/publish` revalidates the tag.
export default async function PublishedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("phase0");
  const title = await getPublishedTitle();
  return (
    <section>
      <h1>{t("publishedHeading")}</h1>
      <p data-testid="published-title">{title}</p>
    </section>
  );
}
