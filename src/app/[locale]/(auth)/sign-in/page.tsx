import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignInNotice } from "@/components/auth/sign-in-notice";

// A9: one button. A plain link to /auth/start, which the Worker answers before Next.js starts, so the page needs no JavaScript to work.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signIn" });
  return { title: t("title"), robots: { index: false } };
}

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.signIn");
  return (
    <main className="auth-card">
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <SignInNotice />
      {/* A full navigation to a Worker route, not a page: <Link> would prefetch it and try a client-side transition. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="auth-button" href="/auth/start">
        {t("google")}
      </a>
      <p className="auth-muted">{t("noGoogle")}</p>
    </main>
  );
}
