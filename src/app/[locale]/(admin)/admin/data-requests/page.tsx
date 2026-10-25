import { setRequestLocale } from "next-intl/server";
import { DataRequestsPanel } from "@/components/admin/data-requests-panel";

// B5.
export default async function AdminDataRequestsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DataRequestsPanel />;
}
