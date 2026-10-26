import { setRequestLocale } from "next-intl/server";
import { PerformanceAllPanel } from "@/components/admin/performance-all-panel";

// C3. Owner only: the data call refuses anyone else. An admin sees only their own numbers, on the Analytics screen.
export default async function AdminPerformanceAllPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PerformanceAllPanel />;
}
