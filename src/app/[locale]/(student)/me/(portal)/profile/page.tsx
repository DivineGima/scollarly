import { setRequestLocale } from "next-intl/server";
import { ProfilePanel } from "@/components/student/profile-panel";

// A13 step 1. A shell with no data: the name and email are read in the browser after the page loads.
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProfilePanel />;
}
