import { getTranslations, setRequestLocale } from "next-intl/server";

// S0.2: fully prerendered. A cached hit must cost at most 5 ms of CPU and touch no database.
export const dynamic = "force-static";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("promise")}</p>
      <p>{t("phase0")}</p>
      <p>
        {/* A plain anchor on purpose: a full navigation lets the service worker answer, and avoids client-router prefetching on data-limited phones. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/offline">{t("offlineLink")}</a>
      </p>
    </main>
  );
}
