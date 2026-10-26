import { setRequestLocale } from "next-intl/server";
import { SettingsPanel } from "@/components/admin/settings-panel";

// C4. Owner only: the data call refuses anyone else, and so does the database (policy `site_setting_update`).
export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SettingsPanel />;
}
