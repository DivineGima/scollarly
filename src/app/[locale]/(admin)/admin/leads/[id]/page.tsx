import { setRequestLocale } from "next-intl/server";
import { LeadDetailPanel } from "@/components/admin/lead-detail-panel";

// B3. One shell for every lead: the screen reads the id from the address, so nothing about a lead is in this page. The Worker
// serves every /admin/leads/<id> from the copy prerendered here under the placeholder id (`canonicalShellPath`).
export function generateStaticParams() {
  return [{ id: "_" }];
}

export default async function AdminLeadDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LeadDetailPanel />;
}
