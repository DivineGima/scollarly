import { setRequestLocale } from "next-intl/server";
import { LeadsPanel } from "@/components/admin/leads-panel";

// B2. A shell with no data: the list, its filters and its tabs are read in the browser after the page loads.
export default async function AdminLeadsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LeadsPanel />;
}
