import { getTranslations, setRequestLocale } from "next-intl/server";

export const dynamic = "force-static";

export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("offline");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("body")}</p>
    </main>
  );
}
