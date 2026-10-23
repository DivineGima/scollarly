import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { isLocale, locales } from "@/i18n/config";
import "../globals.css";

export const metadata: Metadata = { title: "Scollarly", description: "Study in India from Africa." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1d4ed8" };

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/**
 * No client provider here on purpose: public pages are server components, so no message catalogue is
 * sent to the browser. A client island that needs strings gets a provider with only its own namespace (S1.6).
 */
export default async function RootLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
