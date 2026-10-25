import { setRequestLocale } from "next-intl/server";
import { OverviewPanel } from "@/components/admin/overview-panel";

// B1 shell: the counts and the funnel are read in the browser after the page loads (S5.3).
export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OverviewPanel />;
}
