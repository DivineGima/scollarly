import { setRequestLocale } from "next-intl/server";
import { ContentSections } from "@/components/admin/hubs";

// S13.6: the Content hub. Sections: the kinds of content, what is stale, the images. A shell with no data.
export default async function AdminContentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentSections />;
}
