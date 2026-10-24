import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignOutRunner } from "@/components/auth/sign-out-runner";

// A10: ends the session, then goes to the home page.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signOut" });
  return { title: t("working"), robots: { index: false } };
}

export default async function SignOutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="auth-card">
      <SignOutRunner />
    </main>
  );
}
