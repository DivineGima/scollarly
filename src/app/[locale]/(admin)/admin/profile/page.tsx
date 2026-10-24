import { setRequestLocale } from "next-intl/server";
import { ProfilePanel } from "@/components/admin/profile-panel";

// B11.
export default async function AdminProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProfilePanel />;
}
