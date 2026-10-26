import { setRequestLocale } from "next-intl/server";
import { ContentHub } from "@/components/admin/content/hub-panel";

// B6. A shell with no data: the cards and their counts are read in the browser after the page loads.
export default async function AdminContentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentHub />;
}
