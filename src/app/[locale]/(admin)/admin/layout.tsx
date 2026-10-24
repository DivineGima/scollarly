import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";
import "./admin.css";

export const metadata: Metadata = { title: "Scollarly admin", robots: { index: false, follow: false } };

/**
 * Every /admin screen (S2.6, ADR-040). A prerendered shell: the same HTML for everyone and nothing private in it. The Worker
 * entry answers 404 to anyone who is not an admin or the owner before this page is served, and the shell fetches the person's
 * session and the screen's data afterwards. Tailwind and the shadcn-style components are imported here and nowhere else.
 */
export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const messages = await clientMessages(locale as Locale, ["admin", "phase0"]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AdminShell>{children}</AdminShell>
    </NextIntlClientProvider>
  );
}
