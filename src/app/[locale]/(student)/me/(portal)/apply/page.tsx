import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { ApplyScreen } from "@/components/student/apply-screen";
import type { Locale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";
import { readProgrammeChoices } from "@/modules/content/course-catalogue";

// S15.3 (PRD_4 F24, architecture 23.3): the Apply screen. A shell with no personal data: the public programme list is embedded (the same for
// everyone), and whether the person has applied and which courses they chose are read in the browser after the page loads.
export default async function ApplyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [messages, programmes] = await Promise.all([clientMessages(locale as Locale, ["me", "student", "courses"]), readProgrammeChoices()]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ApplyScreen programmes={programmes} />
    </NextIntlClientProvider>
  );
}
