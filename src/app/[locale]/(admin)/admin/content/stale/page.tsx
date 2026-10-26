import { setRequestLocale } from "next-intl/server";
import { StalePanel } from "@/components/admin/content/stale-panel";

// B8. A shell with no data: the overdue items are read in the browser after the page loads.
export default async function AdminStalePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StalePanel />;
}
