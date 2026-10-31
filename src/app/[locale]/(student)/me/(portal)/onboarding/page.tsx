import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { isLocale, type Locale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";
import "@/components/onboarding/onboarding.css";

export const metadata: Metadata = { title: "Scollarly", robots: { index: false, follow: false } };

// S13.3 (architecture 21.4, 21.6): the questionnaire for a new student or parent. A shell with no data, the same HTML for everyone: the
// Worker answers 404 to anyone who is not signed in with a confirmed account, and the screens read their own state in the browser.
export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const messages = await clientMessages(locale as Locale, ["me", "onboarding", "courses"]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <OnboardingFlow />
    </NextIntlClientProvider>
  );
}
