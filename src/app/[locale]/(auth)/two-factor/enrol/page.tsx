import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TwoFactorEnrol } from "@/components/auth/two-factor-enrol";

// C0. A data-free shell: the Worker entry lets only a signed-in session reach it (src/server/edge/authed.ts, area `auth`)
// and the island asks /api/v1/auth/two-factor-status whether this account is the owner.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.twoFactor" });
  return { title: t("enrolTitle"), robots: { index: false } };
}

export default async function TwoFactorEnrolPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.twoFactor");
  return (
    <main className="auth-card">
      <h1>{t("enrolTitle")}</h1>
      <TwoFactorEnrol />
    </main>
  );
}
