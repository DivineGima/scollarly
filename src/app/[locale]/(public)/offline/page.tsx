import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLink } from "@/components/public/page-link";
import { NAV_ITEMS } from "@/components/public/site-header";
import { OfflineProgress } from "@/components/student/offline-progress";
import { PIPELINE_STAGE_CODES } from "@/lib/constants";
import { COURSE_FIELDS } from "@/lib/courses";
import { readCourseCatalogue } from "@/modules/content/course-catalogue";

export const dynamic = "force-static";

/** A8. Shown when a page is not saved on the phone. It lists the pages that may be saved, so the visitor can try them. */
export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, nav, me, stages, uni, home, courses, catalogue] = await Promise.all([
    getTranslations("offline"),
    getTranslations("site.nav"),
    getTranslations("me.progress"),
    getTranslations("me.stages"),
    getTranslations("student.universities"),
    getTranslations("student.home"),
    getTranslations("courses"),
    readCourseCatalogue(),
  ]);
  return (
    <>
      <h1>{t("title")}</h1>
      <p>{t("body")}</p>
      {/* S8.1: a student who was signed in sees the last stage kept on this phone; anyone else sees nothing here. The words are
          rendered here, so the island needs no translation runtime (this page is saved on every visitor's phone). */}
      <OfflineProgress
        labels={{ title: me("title"), body: me("offline.body"), reference: me("reference"), stage: me("offline.stage"), lastUpdated: me.raw("lastUpdated") as string }}
        stageNames={Object.fromEntries(PIPELINE_STAGE_CODES.map((code) => [code, stages(code)]))}
        universities={{
          // The public catalogue, the same for everyone; the order for one person is made on their phone from the copy it kept (S13.4).
          catalogue,
          courseNames: Object.fromEntries(COURSE_FIELDS.map((field) => [field, courses(field)])),
          labels: { naac: uni.raw("naac") as string, naacMissing: uni("naacMissing"), offers: uni.raw("offers") as string, open: uni.raw("open") as string },
          greeting: home.raw("greeting") as string,
          title: home("forYou.title"),
        }}
      />
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
