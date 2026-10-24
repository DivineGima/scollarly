import { getTranslations } from "next-intl/server";
import { PageLink } from "./page-link";

export async function SiteFooter() {
  const t = await getTranslations("site");
  return (
    <footer className="site-footer">
      <div className="container">
        <p className="footer-brand">{t("name")}</p>
        <p className="muted">{t("footer.tagline")}</p>
        <ul className="footer-links">
          <li>
            <PageLink href="/privacy">{t("footer.privacy")}</PageLink>
          </li>
          <li>
            <PageLink href="/terms">{t("footer.terms")}</PageLink>
          </li>
          <li>
            <PageLink href="/contact">{t("nav.contact")}</PageLink>
          </li>
          <li>
            <PageLink href="/sign-in">{t("signIn")}</PageLink>
          </li>
        </ul>
      </div>
    </footer>
  );
}
