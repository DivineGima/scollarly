import { getTranslations } from "next-intl/server";
import { PageLink } from "./page-link";
import { CreateAccountLink } from "./create-account-link";

export const NAV_ITEMS = [
  { href: "/", key: "home" },
  { href: "/universities", key: "universities" },
  { href: "/campus-tours", key: "tours" },
  { href: "/process", key: "process" },
  { href: "/visa", key: "visa" },
  { href: "/faq", key: "faq" },
  { href: "/blog", key: "blog" },
  { href: "/about", key: "about" },
  { href: "/contact", key: "contact" },
] as const;

/**
 * The top of every public page. There is no menu script: the links sit in a row that scrolls sideways on a phone, so the
 * whole site works without JavaScript and costs no bytes (architecture 6.3, FR-1).
 */
export async function SiteHeader() {
  const t = await getTranslations("site");
  return (
    <header className="site-header">
      <div className="container bar">
        <PageLink href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo from our own files; the image optimiser is not used on this platform */}
          <img className="brand-mark" src="/brand/logo.svg" width={28} height={25} alt="" />
          {t("name")}
        </PageLink>
        <div className="bar-actions">
          {/* `/account` sends a signed-out visitor to Sign in; the account-link island hides this link for a signed-in browser, where the button beside it reads "My account" (PRD_4 F25). */}
          <PageLink href="/account" className="link-quiet" data-sign-in-link data-hide-signed-in>
            {t("signIn")}
          </PageLink>
          <CreateAccountLink next="/" size="small" />
        </div>
      </div>
      <nav aria-label={t("nav.label")} className="site-nav">
        <ul className="container">
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <PageLink href={item.href}>{t(`nav.${item.key}`)}</PageLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
