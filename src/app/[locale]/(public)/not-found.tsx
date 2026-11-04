import { getTranslations } from "next-intl/server";
import { PageLink } from "@/components/public/page-link";

/** The 404 page of the public site: inside the page frame, so it has the header, the footer and the page language. */
export default async function PublicNotFound() {
  const t = await getTranslations("site.notFound");
  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("body")}</p>
      <p>
        <PageLink href="/" className="btn btn-primary">
          {t("home")}
        </PageLink>
      </p>
    </>
  );
}
