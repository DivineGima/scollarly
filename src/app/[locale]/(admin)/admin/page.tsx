import { setRequestLocale } from "next-intl/server";
import { AdminHome } from "@/components/admin/admin-home";

// S13.6: the staff Home. A shell with no data: the tiles, the chart and the latest activity are read in the browser after the page loads.
export default async function AdminHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminHome />;
}
