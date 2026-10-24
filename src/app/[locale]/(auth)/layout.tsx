import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";
import "./auth.css";

/**
 * Sign-in, sign-out, invite and two-factor pages (Stage 2). Server components with small client islands that carry only the
 * `auth` strings. These pages hold no data: whatever they show comes from the edge endpoints after the page has loaded.
 */
export default async function AuthLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const messages = await clientMessages(locale as Locale, ["auth"]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
