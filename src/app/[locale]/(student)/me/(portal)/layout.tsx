import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/student/student-shell";
import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";
import "./me.css";

export const metadata: Metadata = { title: "Scollarly", robots: { index: false, follow: false } };

/**
 * Every /me screen (S8.1, ADR-040). A prerendered shell: the same HTML for everyone and nothing private in it. The Worker entry answers
 * 404 to anyone who is not signed in before this page is served, and each screen fetches its own data afterwards. Plain CSS on the
 * site's tokens, no admin library, so the portal stays light for a student on a limited data plan.
 */
export default async function StudentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const messages = await clientMessages(locale as Locale, ["me"]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <StudentShell>{children}</StudentShell>
    </NextIntlClientProvider>
  );
}
