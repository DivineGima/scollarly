import { setRequestLocale } from "next-intl/server";
import { OverviewPanel } from "@/components/admin/overview-panel";

// B1 shell. The real Overview arrives with Stage 5 (S5.3).
export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OverviewPanel />;
}
