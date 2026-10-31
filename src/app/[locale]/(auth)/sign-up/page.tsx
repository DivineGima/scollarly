import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignInNotice } from "@/components/auth/sign-in-notice";
import { SignUpChoices } from "@/components/auth/sign-up-choices";

// A2.1 (architecture 21.17): "Create your account", a student or parent choice, and one Google button for each. Plain links, so no
// JavaScript is needed; the script only adds a course picked on the landing page.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signUp" });
  return { title: t("title"), robots: { index: false } };
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.signUp");
  return (
    <main className="auth-card">
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <SignInNotice />
      <SignUpChoices />
      <p className="auth-muted">
        {t("haveAccount")}{" "}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/sign-in">{t("signIn")}</a>
      </p>
      <p className="auth-muted">{t("noGoogle")}</p>
    </main>
  );
}
