import { setRequestLocale } from "next-intl/server";
import { TeamPanel } from "@/components/admin/team-panel";

// C2. Owner only: the data call refuses anyone else, and so does the database (policy `admin_invite_read`).
export default async function AdminTeamPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TeamPanel />;
}
