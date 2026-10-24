import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TwoFactorVerify } from "@/components/auth/two-factor-verify";

// C1. A data-free shell, like the enrolment page.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.twoFactor" });
  return { title: t("verifyTitle"), robots: { index: false } };
}

export default async function TwoFactorVerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.twoFactor");
  return (
    <main className="auth-card">
      <h1>{t("verifyTitle")}</h1>
      <TwoFactorVerify />
    </main>
  );
}
