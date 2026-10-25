import { setRequestLocale } from "next-intl/server";
import { LinkRequestsPanel } from "@/components/admin/link-requests-panel";

// B4.
export default async function AdminLinkRequestsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LinkRequestsPanel />;
}
