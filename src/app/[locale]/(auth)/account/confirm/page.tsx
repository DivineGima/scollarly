import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ConfirmAccount } from "@/components/auth/confirm-account";

// A2.1 step 5 (architecture 21.17): shown only to a signed-in Google login with no confirmed Scollarly account. The Worker checks the
// session before it serves this page (area `account`), so anyone else gets a 404; the page itself is the same HTML for everyone.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.confirm" });
  return { title: t("title"), robots: { index: false } };
}

export default async function ConfirmAccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="auth-card">
      <ConfirmAccount />
    </main>
  );
}
