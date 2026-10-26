import { setRequestLocale } from "next-intl/server";
import { ContentList } from "@/components/admin/content/list-panel";
import { CONTENT_TYPE_KEYS } from "@/modules/content-admin/definitions";

// B6 step 1. One shell per content type; the list itself is read in the browser. `media` and `stale` are their own pages.
export const dynamicParams = false;

export function generateStaticParams() {
  return CONTENT_TYPE_KEYS.map((type) => ({ type }));
}

export default async function AdminContentListPage({ params }: { params: Promise<{ locale: string; type: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentList />;
}
