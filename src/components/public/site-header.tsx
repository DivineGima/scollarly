import { getTranslations } from "next-intl/server";
import { PageLink } from "./page-link";

export const NAV_ITEMS = [
  { href: "/", key: "home" },
  { href: "/universities", key: "universities" },
  { href: "/fees", key: "fees" },
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
          {t("name")}
        </PageLink>
        <div className="bar-actions">
          <PageLink href="/sign-in" className="link-quiet">
            {t("signIn")}
          </PageLink>
          <PageLink href="/apply" className="btn btn-primary btn-small">
            {t("apply")}
          </PageLink>
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
