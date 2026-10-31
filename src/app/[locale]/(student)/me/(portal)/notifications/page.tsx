import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { NotificationsPanel } from "@/components/notifications/notifications-panel";
import type { Locale } from "@/i18n/config";
import { clientMessages } from "@/i18n/messages";

// S13.5 (architecture 21.8): the student's Notifications, behind the round More button. A shell with no data: the list is read in the browser.
export default async function MeNotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await clientMessages(locale as Locale, ["me", "notifications"]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <NotificationsPanel area="me" />
    </NextIntlClientProvider>
  );
}
