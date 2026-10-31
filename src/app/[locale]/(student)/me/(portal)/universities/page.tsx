import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { UniversitiesPanel } from "@/components/student/universities-panel";
import type { Locale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";
import { readCourseCatalogue } from "@/modules/content/course-catalogue";

// S13.4: the Universities tab. The public catalogue is embedded and is the same for everyone; the person's own courses are read in the browser.
export default async function MeUniversitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [messages, catalogue] = await Promise.all([clientMessages(locale as Locale, ["me", "student", "courses"]), readCourseCatalogue()]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <UniversitiesPanel catalogue={catalogue} />
    </NextIntlClientProvider>
  );
}
