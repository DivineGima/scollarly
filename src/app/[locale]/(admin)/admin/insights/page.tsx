import { setRequestLocale } from "next-intl/server";
import { InsightsHub } from "@/components/admin/hubs";

// S13.6: the Insights hub. Sections: results (funnel, sources, own numbers) and payments. A shell with no data.
export default async function AdminInsightsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <InsightsHub />;
}
