import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { StudentHome } from "@/components/student/student-home";
import type { Locale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";
import { readCourseCatalogue } from "@/modules/content/course-catalogue";

// S13.4: the student's Home. A shell with no personal data: the public course catalogue is embedded (the same for everyone), and the name,
// the answers and the stage are read in the browser after the page loads.
export default async function MePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [messages, catalogue] = await Promise.all([clientMessages(locale as Locale, ["me", "student", "courses"]), readCourseCatalogue()]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <StudentHome catalogue={catalogue} />
    </NextIntlClientProvider>
  );
}
