import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InviteAccept } from "@/components/auth/invite-accept";

// B0. The token is in the address and is read in the browser, never here, so no page or cache entry on the server holds a secret.
// The page is the same for every token and rendered per request: invites are rare, and nothing is cached under a secret address.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.invite" });
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function AcceptInvitePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.invite");
  return (
    <main className="auth-card">
      <h1>{t("title")}</h1>
      <InviteAccept />
    </main>
  );
}
