import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { FilePanel } from "@/components/student/file-panel";
import type { Locale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";

// S17.2 and S17.3 (PRD_5 FR-43 to FR-46): "My file", the step-2 form, the documents, the proof of payment and the letters. A shell with no data:
// the form, the documents and the letters are all read in the browser after the page loads, and the files go from the phone to private storage.
export default async function MeFilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await clientMessages(locale as Locale, ["me", "courses"]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <FilePanel />
    </NextIntlClientProvider>
  );
}
