import { setRequestLocale } from "next-intl/server";
import { AnalyticsPanel } from "@/components/admin/analytics-panel";

// B10. A shell with no data: the funnel, the sources and the admin's own numbers are read in the browser after the page loads.
export default async function AdminAnalyticsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AnalyticsPanel />;
}
