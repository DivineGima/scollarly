import { setRequestLocale } from "next-intl/server";
import { SecurityPanel } from "@/components/admin/security-panel";

// C6. Owner only.
export default async function AdminSecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SecurityPanel />;
}
