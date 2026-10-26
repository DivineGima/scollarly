import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ContentForm } from "@/components/admin/content/form-panel";
import { CONTENT_TYPE_KEYS } from "@/modules/content-admin/definitions";

// B6 steps 2 to 11. One shell per content type for every item (and for "new"): the screen reads the type and the id from the
// address, so nothing about an item is in this page. The Worker serves every /admin/content/<type>/<id> from the copy prerendered
// here under the placeholder id (`canonicalShellPath`). Any id is rendered on demand when this page is run without the Worker (tests, `next start`); only the type is checked.
export function generateStaticParams() {
  return CONTENT_TYPE_KEYS.map((type) => ({ type, id: "_" }));
}

export default async function AdminContentItemPage({ params }: { params: Promise<{ locale: string; type: string; id: string }> }) {
  const { locale, type } = await params;
  if (!(CONTENT_TYPE_KEYS as readonly string[]).includes(type)) notFound();
  setRequestLocale(locale);
  return <ContentForm />;
}
