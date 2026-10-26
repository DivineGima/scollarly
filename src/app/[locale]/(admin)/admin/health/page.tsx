import { setRequestLocale } from "next-intl/server";
import { HealthPanel } from "@/components/admin/health-panel";

// C7. Owner only: the data call refuses anyone else.
export default async function AdminHealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HealthPanel />;
}
