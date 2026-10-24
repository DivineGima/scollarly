import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLink } from "@/components/public/page-link";
import { NAV_ITEMS } from "@/components/public/site-header";

export const dynamic = "force-static";

/** A8. Shown when a page is not saved on the phone. It lists the pages that may be saved, so the visitor can try them. */
export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, nav] = await Promise.all([getTranslations("offline"), getTranslations("site.nav")]);
  return (
    <>
      <h1>{t("title")}</h1>
      <p>{t("body")}</p>
      <h2>{t("pagesHeading")}</h2>
      <ul>
        {NAV_ITEMS.map((item) => (
          <li key={item.key}>
            <PageLink href={item.href}>{nav(item.key)}</PageLink>
          </li>
        ))}
      </ul>
    </>
  );
}
