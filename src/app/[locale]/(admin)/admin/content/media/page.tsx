import { setRequestLocale } from "next-intl/server";
import { MediaPanel } from "@/components/admin/content/media-panel";

// B7. A shell with no data: the image grid and the meter are read in the browser after the page loads.
export default async function AdminMediaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MediaPanel />;
}
