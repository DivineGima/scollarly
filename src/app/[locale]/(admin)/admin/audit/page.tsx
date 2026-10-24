import { setRequestLocale } from "next-intl/server";
import { AuditPanel } from "@/components/admin/audit-panel";

// C5. Owner only.
export default async function AdminAuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AuditPanel />;
}
