import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { NotificationsPanel } from "@/components/notifications/notifications-panel";
import type { Locale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";

// S13.5 (architecture 21.8): staff Notifications. The data call shows an admin their own items and the owner the owner-only ones as well.
export default async function AdminNotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await clientMessages(locale as Locale, ["me", "notifications"]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <NotificationsPanel area="admin" />
    </NextIntlClientProvider>
  );
}
