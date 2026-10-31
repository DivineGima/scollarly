import { setRequestLocale } from "next-intl/server";
import { LeadsHub } from "@/components/admin/hubs";

// S13.6: the Leads hub. Sections: the list, the link requests, the data requests. A shell with no data: each section reads its own data.
export default async function AdminLeadsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LeadsHub />;
}
