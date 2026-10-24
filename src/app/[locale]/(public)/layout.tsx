import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClientShell } from "@/components/public/client-shell";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import "./public.css";

export const metadata: Metadata = {
  title: { default: "Scollarly", template: "%s | Scollarly" },
  description: "Study in India from Africa.",
};

/**
 * The frame of every public page (S3.2). It holds no script of its own: the header, the footer and the skip link are
 * server-rendered, so every public page shows its main content with JavaScript off (FR-1). The one `<style>` inside
 * `<noscript>` hides the controls that only work with JavaScript (filters, copy button). The only client code of the frame is
 * `ClientShell`: the offline runtime and the quick WhatsApp form (architecture 6.3).
 */
export default async function PublicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("site");
  return (
    <div className="site">
      <noscript>
        <style>{".js-only{display:none!important}"}</style>
      </noscript>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <SiteHeader />
      <main id="main" className="container">
        {children}
      </main>
      <SiteFooter />
      <ClientShell locale={locale} />
    </div>
  );
}
